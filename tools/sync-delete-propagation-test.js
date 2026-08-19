const assert = require('node:assert/strict');

function createDeleteSync(remote) {
  const local = new Map();
  const baseline = new Map();
  const tombstones = new Map();
  const pending = new Set();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const persist = async (key, value) => {
    local.set(key, clone(value));
    pending.add(key);
    const ids = new Set((tombstones.get(key) || []).map(String));
    const next = clone(value);
    remote.set(key, remote.get(key).filter(record => !ids.has(String(record.id))));
    const remoteIds = new Set(remote.get(key).map(record => String(record.id)));
    for (const record of next) {
      remote.get(key).push(record);
    }
    remote.set(key, remote.get(key).filter((record, index, all) => all.findIndex(x => String(x.id) === String(record.id)) === index));
    baseline.set(key, clone(remote.get(key)));
    pending.delete(key);
    tombstones.delete(key);
  };
  const markDelete = (key, id) => {
    const list = tombstones.get(key) || [];
    if (!list.includes(String(id))) list.push(String(id));
    tombstones.set(key, list);
  };
  const protectedRemoteRead = (key) => {
    const blocked = new Set((tombstones.get(key) || []).map(String));
    return remote.get(key).filter(record => !blocked.has(String(record.id)));
  };
  return { remote, local, baseline, tombstones, pending, persist, markDelete, protectedRemoteRead };
}

(async () => {
  const remote = new Map([['visitsClinic', [{ id: 'p-1', patient: 'اختبار حذف' }, { id: 'p-2', patient: 'يبقى' }]]]);
  const sync = createDeleteSync(remote);
  sync.local.set('visitsClinic', [{ id: 'p-1', patient: 'اختبار حذف' }, { id: 'p-2', patient: 'يبقى' }]);
  sync.baseline.set('visitsClinic', [{ id: 'p-2', patient: 'يبقى' }]);

  // الحذف لا يظهر في baseline القديمة، لكنه يجب أن يصل بفضل tombstone.
  sync.markDelete('visitsClinic', 'p-1');
  sync.local.set('visitsClinic', [{ id: 'p-2', patient: 'يبقى' }]);
  assert.equal(sync.protectedRemoteRead('visitsClinic').some(r => r.id === 'p-1'), false);
  await sync.persist('visitsClinic', sync.local.get('visitsClinic'));
  assert.equal(remote.get('visitsClinic').some(r => r.id === 'p-1'), false);
  assert.equal(remote.get('visitsClinic').some(r => r.id === 'p-2'), true);
  assert.equal(sync.pending.size, 0);
  assert.equal(sync.tombstones.has('visitsClinic'), false);

  console.log('PASS sync-delete-propagation-test: explicit tombstone deletes a remote record even when the local baseline is stale, and stale reads cannot resurrect it.');
})();
