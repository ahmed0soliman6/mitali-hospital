const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadHandler() {
  const deleted = [];
  const writes = [];
  const reads = new Map();
  const collection = (name) => ({
    limit: () => ({
      get: async () => {
        const count = Number(reads.get(name) || 0);
        reads.set(name, count + 1);
        if (name === 'system_control') return { docs: [] };
        if (count > 0) return { docs: [] };
        return { docs: [{ ref: { collection: name, id: `demo-${name}` } }] };
      },
    }),
    doc: (id) => ({
      set: async (value) => writes.push({ collection: name, id, value }),
    }),
  });
  const firestore = {
    collection,
    batch: () => ({
      delete: (ref) => deleted.push(`${ref.collection}/${ref.id}`),
      commit: async () => {},
    }),
  };
  const api = { firestore: () => firestore };
  const adminLib = { requireManager: async () => ({ api, uid: 'manager' }) };
  const sandbox = {
    console,
    require: (request) => {
      if (request === '../_lib/firebase-admin') return adminLib;
      if (request === 'crypto') return require('crypto');
      throw new Error(`Unexpected require: ${request}`);
    },
    module: { exports: {} },
    exports: {},
  };
  vm.runInNewContext(fs.readFileSync('api/admin/data.js', 'utf8'), sandbox, { filename: 'api/admin/data.js' });
  return { handler: sandbox.module.exports, deleted, writes };
}

async function invoke(handler, body) {
  let status = 0;
  let payload = null;
  const res = {
    status(value) { status = value; return this; },
    setHeader() { return this; },
    end(value) { payload = JSON.parse(value); },
  };
  await handler({ method: 'POST', body, headers: { authorization: 'Bearer test' } }, res);
  return { status, payload };
}

(async () => {
  const first = loadHandler();
  const rejected = await invoke(first.handler, { action: 'wipeBusinessData', confirmationText: 'حذف كل البيانات' });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.payload.error, 'confirmation-required');
  assert.equal(first.deleted.length, 0);

  const second = loadHandler();
  const accepted = await invoke(second.handler, { action: 'wipeBusinessData', confirmationText: 'حذف كل بيانات المستشفى' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.ok, true);
  assert.equal(accepted.payload.preserveAccounts, true);
  assert.equal(accepted.payload.totalDeleted, 8);
  assert.equal(second.deleted.some((value) => value.startsWith('users/')), false);
  assert.equal(second.deleted.some((value) => value.startsWith('staff_accounts/')), false);
  assert.equal(second.writes.length, 1);
  assert.equal(second.writes[0].collection, 'system_control');
  assert.equal(second.writes[0].id, 'app');
  assert.equal(accepted.payload.preserveSettings, true);
  assert.equal(accepted.payload.preserveDoctors, true);
  assert.equal(accepted.payload.preserveEmployees, true);
  assert.equal(second.handler.WIPE_COLLECTIONS.includes('doctors'), false);
  assert.equal(second.handler.WIPE_COLLECTIONS.includes('employees'), false);
  assert.equal(second.handler.WIPE_COLLECTIONS.includes('settings'), false);
  assert.equal(second.handler.WIPE_COLLECTIONS.includes('categories'), false);

  console.log('PASS data-wipe-api-test: exact confirmation is required, business collections are cleared, and account collections are preserved.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
