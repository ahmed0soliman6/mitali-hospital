const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');
const grab = (re, name) => { const m = index.match(re); assert.ok(m, name + ' must exist'); return m[0]; };
const fnLink = grab(/function visitLinkFromIncome\(inc\) \{[\s\S]*?\n\}\n/, 'visitLinkFromIncome');
const fnLoad = grab(/async function loadVisitsBeforeCascade\(link\) \{[\s\S]*?\n\}\n/, 'loadVisitsBeforeCascade');
const fnCascade = grab(/async function cascadeDeleteVisitForIncome\(link\) \{[\s\S]*?\n\}\n/, 'cascadeDeleteVisitForIncome');

const SOURCES = [
  { dbKey: 'visitsClinic', kind: 'عيادات', kindKey: 'clinic' },
  { dbKey: 'visitsDental', kind: 'أسنان', kindKey: 'dental' },
  { dbKey: 'visitsOperations', kind: 'عمليات', kindKey: 'operations' },
  { dbKey: 'visitsLabs', kind: 'تحاليل', kindKey: 'labs' },
  { dbKey: 'visitsRadiology', kind: 'أشعة', kindKey: 'radiology' },
];
function make(extra) {
  const log = [];
  const pageStates = {};
  const sandbox = Object.assign({
    VISIT_SOURCE_DEFINITIONS: SOURCES, STORAGE_MODE: 'firestore', currentUser: { id: 'u' },
    DB: { visitsClinic: [], visitsDental: [], visitsOperations: [], visitsLabs: [], visitsRadiology: [] },
    loadFirestorePage: async (key, page, opts) => { log.push(['load', key, page, JSON.stringify(opts)]); return true; },
    markSyncTombstone: async (key, id) => { log.push(['tombstone', key, id]); },
    persist: async key => { log.push(['persist', key]); },
    logActivity: (action, page, before, after) => { log.push(['log', action, page, before && before.id, after]); },
    getFirestorePageState: key => (pageStates[key] = pageStates[key] || { pages: { 1: ['stale'] } }),
  }, extra || {});
  sandbox.log = log; sandbox.pageStates = pageStates;
  vm.createContext(sandbox);
  vm.runInContext([fnLink, fnLoad, fnCascade].join('\n') + '\nthis.api = { visitLinkFromIncome, loadVisitsBeforeCascade, cascadeDeleteVisitForIncome };', sandbox);
  return sandbox;
}
const J = x => JSON.stringify(x);

(async () => {
  // 1) استخراج الزيارة من معرّف قيد الوارد
  const a = make().api;
  for (const src of SOURCES) {
    const link = a.visitLinkFromIncome({ id: `visit-income-${src.kindKey}-mtab12-xyz` });
    assert.ok(link, src.kindKey);
    assert.strictEqual(link.source.dbKey, src.dbKey);
    assert.strictEqual(link.visitId, 'mtab12-xyz');
  }
  assert.strictEqual(a.visitLinkFromIncome({ id: 'muhgr0go242ba' }), null, 'manual income is not linked');
  assert.strictEqual(a.visitLinkFromIncome({ id: 'visit-income-unknown-1' }), null);
  assert.strictEqual(a.visitLinkFromIncome(null), null);

  // 2) تحميل أول صفحة قبل الحذف
  let sb = make();
  let link = sb.api.visitLinkFromIncome({ id: 'visit-income-dental-v1' });
  assert.strictEqual(await sb.api.loadVisitsBeforeCascade(link), true);
  assert.strictEqual(J(sb.log[0]), J(['load', 'visitsDental', 1, '{"force":true}']));
  sb = make({ loadFirestorePage: async () => false });
  link = sb.api.visitLinkFromIncome({ id: 'visit-income-dental-v1' });
  assert.strictEqual(await sb.api.loadVisitsBeforeCascade(link), false, 'failed load must block the delete');
  sb = make({ STORAGE_MODE: 'local' });
  link = sb.api.visitLinkFromIncome({ id: 'visit-income-dental-v1' });
  assert.strictEqual(await sb.api.loadVisitsBeforeCascade(link), true);
  assert.strictEqual(sb.log.length, 0, 'local mode must not read from Firestore');

  // 3) حذف الزيارة المرتبطة: tombstone ثم إزالة محلية ثم persist ثم إبطال اللقطة
  sb = make();
  sb.DB.visitsDental = [{ id: 'v1' }, { id: 'v2' }];
  link = sb.api.visitLinkFromIncome({ id: 'visit-income-dental-v1' });
  await sb.api.cascadeDeleteVisitForIncome(link);
  assert.strictEqual(J(sb.DB.visitsDental.map(v => v.id)), '["v2"]');
  const kinds = sb.log.map(e => e[0]);
  assert.strictEqual(J(kinds), '["tombstone","log","persist"]');
  assert.strictEqual(J(sb.log[0]), J(['tombstone', 'visitsDental', 'v1']));
  assert.strictEqual(J(sb.log[2]), J(['persist', 'visitsDental']));
  assert.strictEqual(J(sb.pageStates.visitsDental.pages), '{}', 'cached page snapshot must be invalidated');
  assert.strictEqual(sb.DB.visitsClinic.length, 0, 'other tables untouched');

  // 4) الزيارة غير محمّلة محليًا: يُحذف المستند بالـ tombstone أيضًا
  sb = make();
  link = sb.api.visitLinkFromIncome({ id: 'visit-income-clinic-zzz' });
  await sb.api.cascadeDeleteVisitForIncome(link);
  assert.strictEqual(J(sb.log.map(e => e[0])), '["tombstone","log","persist"]');
  assert.strictEqual(J(sb.log[0]), J(['tombstone', 'visitsClinic', 'zzz']));

  // 5) معالج حذف الوارد
  const h = index.slice(index.indexOf('c.querySelectorAll("[data-del]")', index.indexOf('function renderMoneyPage')));
  const handler = h.slice(0, h.indexOf('console.log("Money page ready.")'));
  const pos = t => { const i = handler.indexOf(t); assert.ok(i > -1, 'missing in handler: ' + t); return i; };
  assert.ok(pos('const visitLink = linkTarget ? visitLinkFromIncome(linkTarget) : null;') < pos('if (!confirm('));
  assert.ok(pos('can(visitLink.source.kindKey, "delete")') < pos('if (!confirm('));
  assert.ok(pos('if (!confirm(') < pos('loadVisitsBeforeCascade(visitLink)'));
  assert.ok(pos('loadVisitsBeforeCascade(visitLink)') < pos('const idx = list.findIndex'));
  assert.ok(pos('await persist(isIncome ? "income" : "expense");') < pos('cascadeDeleteVisitForIncome(visitLink)'));
  assert.ok(pos('cascadeDeleteVisitForIncome(visitLink)') < pos('showToast("تم الحذف")'));
  assert.match(handler, /if \(visitLink && source\.dbKey === visitLink\.source\.dbKey\) continue;/);

  // 6) لم نلمس المستمعات ولا مفاتيح التحميل
  assert.match(index, /dashboard: \["income", "expense"\]/);
  assert.match(index, /clinic: \["visitsClinic"\]/);

  console.log('PASS income-delete-cascade-test: deleting a visit-linked income also deletes its visit (tombstone + persist + snapshot invalidation), manual income is unaffected, and a failed load blocks the whole delete.');
})().catch(err => { console.error(err); process.exit(1); });
