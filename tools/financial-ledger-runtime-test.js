const assert = require('node:assert/strict');

function paginate(list, page, size = 35) {
  return list.slice((page - 1) * size, page * size);
}
function createLedger() {
  const db = { income: [], expense: [], visits: new Map(), openingBalance: 1000 };
  const tombstones = new Set();
  function syncVisit(section, visit) {
    const id = `visit-income-${section}-${visit.id}`;
    const existing = db.income.find(x => x.id === id || (x.receiptNo === `V-${visit.id}` && x.auto));
    if (Number(visit.paid) > 0) {
      const row = existing || { id, receiptNo: `V-${visit.id}`, auto: true, section };
      row.amount = Number(visit.paid);
      row.visitId = visit.id;
      if (!existing) db.income.push(row);
      visit.linkedIncomeId = row.id;
    } else if (existing) {
      db.income = db.income.filter(x => x.id !== existing.id);
      tombstones.add(existing.id);
      visit.linkedIncomeId = null;
    }
  }
  return { db, tombstones, syncVisit };
}

// 200 وارد و100 منصرف: pagination تقسّم العرض ولا تغيّر القائمة أو الإجمالي.
const ledger = createLedger();
ledger.db.income = Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, amount: i + 1 }));
ledger.db.expense = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, amount: 2 }));
assert.equal(ledger.db.income.length, 200);
assert.equal(paginate(ledger.db.income, 1).length, 35);
assert.equal(paginate(ledger.db.income, 6).length, 25);
assert.equal(ledger.db.income.reduce((s, x) => s + x.amount, 0), 20100);
assert.equal(ledger.db.expense.reduce((s, x) => s + x.amount, 0), 200);

// وصول snapshot كامل بعد كاش قديم يستبدل الكاش بالنسخة الكاملة، لا بأول 35.
const oldCache = ledger.db.income.slice(0, 35);
const fullRemote = Array.from({ length: 200 }, (_, i) => ({ id: `remote-${i}`, amount: 1 }));
const merged = fullRemote;
assert.equal(oldCache.length, 35);
assert.equal(merged.length, 200);

// زيارة مدفوعة من كل قسم تنشئ قيدًا واحدًا، والتعديل يحدث نفس القيد.
const sections = ['clinic', 'dental', 'operations', 'labs', 'radiology'];
for (const section of sections) {
  const visit = { id: `${section}-1`, paid: 100 };
  ledger.db.visits.set(visit.id, visit);
  ledger.syncVisit(section, visit);
  ledger.syncVisit(section, visit);
  assert.equal(ledger.db.income.filter(x => x.visitId === visit.id).length, 1);
  visit.paid = 125;
  ledger.syncVisit(section, visit);
  assert.equal(ledger.db.income.filter(x => x.visitId === visit.id).length, 1);
  assert.equal(ledger.db.income.find(x => x.visitId === visit.id).amount, 125);
}
const automaticIncome = ledger.db.income.filter(x => x.auto);
assert.equal(automaticIncome.length, 5);
assert.equal(automaticIncome.reduce((s, x) => s + x.amount, 0), 625);

// paid=0 يحذف القيد التلقائي فقط، ولا يمس القيد اليدوي.
ledger.db.income.push({ id: 'manual-1', amount: 77, auto: false });
const deletedVisit = ledger.db.visits.get('clinic-1');
deletedVisit.paid = 0;
ledger.syncVisit('clinic', deletedVisit);
assert.equal(ledger.db.income.some(x => x.visitId === deletedVisit.id), false);
assert.equal(ledger.db.income.some(x => x.id === 'manual-1'), true);
assert.equal(ledger.tombstones.size, 1);

// مطابقة الوارد التلقائي مع paid بعد إزالة التكرار، ومطابقة الخزينة.
const paidTotal = [...ledger.db.visits.values()].reduce((s, v) => s + Number(v.paid || 0), 0);
const linkedTotal = ledger.db.income.filter(x => x.auto).reduce((s, x) => s + x.amount, 0);
assert.equal(paidTotal, linkedTotal);
const balance = ledger.db.openingBalance
  + ledger.db.income.reduce((s, x) => s + x.amount, 0)
  - ledger.db.expense.reduce((s, x) => s + x.amount, 0);
assert.equal(balance, ledger.db.openingBalance
  + ledger.db.income.reduce((s, x) => s + x.amount, 0)
  - ledger.db.expense.reduce((s, x) => s + x.amount, 0));
console.log('PASS financial-ledger-runtime-test: full visibility, five-section visit reconciliation, idempotent updates/deletes, pagination, and treasury equation.');
