const crypto = require('crypto');
const { getAdmin, requireManager } = require('../_lib/firebase-admin');

const CONFIRMATION_PHRASE = 'حذف كل بيانات المستشفى';
// الحذف السحابي التجاري يقتصر على ملفات المرضى/الزيارات والوارد والمنصرف.
// لا نضع doctors أو employees أو categories أو specialties أو settings أو users هنا.
const WIPE_COLLECTIONS = [
  'visits_clinic', 'visits_dental', 'visits_operations', 'visits_labs', 'visits_radiology',
  'income', 'expense', 'lab_expenses',
];
const CONTROL_COLLECTION = 'system_control';
const CONTROL_DOCUMENT = 'app';

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin === 'null' || origin === 'https://mitali1.vercel.app') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function normalizedError(error) {
  const code = String(error && error.code != null ? error.code : '').toLowerCase();
  const message = String(error && error.message || '').toLowerCase();
  if (code === '8' || code.includes('resource-exhausted') || message.includes('quota exceeded')) {
    return { code: 'firestore-resource-exhausted', status: 503, retryable: true };
  }
  if (code.includes('deadline-exceeded') || message.includes('deadline exceeded')) {
    return { code: 'firebase-deadline-exceeded', status: 503, retryable: true };
  }
  if (code.includes('unavailable') || message.includes('service unavailable')) {
    return { code: 'firebase-unavailable', status: 503, retryable: true };
  }
  return { code: 'data-wipe-failed', status: Number(error && error.status) || 500, retryable: false };
}

async function deleteCollection(api, collectionName) {
  const collection = api.firestore().collection(collectionName);
  let deleted = 0;
  while (true) {
    const snapshot = await collection.limit(400).get();
    if (!snapshot.docs.length) break;
    const batch = api.firestore().batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.docs.length;
    if (snapshot.docs.length < 400) break;
  }
  return deleted;
}

async function wipeBusinessData(api) {
  const deleted = {};
  let total = 0;
  for (const collectionName of WIPE_COLLECTIONS) {
    const count = await deleteCollection(api, collectionName);
    deleted[collectionName] = count;
    total += count;
  }
  const wipeId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const wipedAt = new Date().toISOString();
  await api.firestore().collection(CONTROL_COLLECTION).doc(CONTROL_DOCUMENT).set({
    lastWipeId: wipeId,
    wipeScope: 'business',
    wipedAt,
    preserveAccounts: true,
    preserveSettings: true,
    preserveDoctors: true,
    preserveEmployees: true,
    deletedCollections: WIPE_COLLECTIONS,
  }, { merge: false });
  return { wipeId, wipeScope: 'business', wipedAt, totalDeleted: total, deleted };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
  const input = bodyOf(req);
  try {
    const { api } = await requireManager(req);
    if (input.action !== 'wipeBusinessData') return json(res, 400, { error: 'unknown-action' });
    if (String(input.confirmationText || '') !== CONFIRMATION_PHRASE) {
      return json(res, 400, { error: 'confirmation-required', requiredPhrase: CONFIRMATION_PHRASE });
    }
    const result = await wipeBusinessData(api);
    return json(res, 200, { ok: true, ...result, preserveAccounts: true, preserveSettings: true, preserveDoctors: true, preserveEmployees: true });
  } catch (error) {
    const info = normalizedError(error);
    console.error('data-wipe-error', JSON.stringify({ code: String(error && error.code || ''), message: String(error && error.message || '').slice(0, 240), normalized: info.code }));
    if (info.status === 503) res.setHeader('Retry-After', '30');
    return json(res, info.status, { error: info.code, retryable: info.retryable });
  }
};

module.exports.CONFIRMATION_PHRASE = CONFIRMATION_PHRASE;
module.exports.WIPE_COLLECTIONS = WIPE_COLLECTIONS;
