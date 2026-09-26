const {
  getAdmin,
  authEmailForUsername,
  cleanPermissions,
  fullPermissions,
  requireManager,
  readProfile,
  writeProfilePair,
  listProfiles,
  sanitizeProfile,
  hashRecoveryCode,
  recoveryCodeMatches,
} = require('../_lib/firebase-admin');

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin === 'null' || origin === 'https://mitali1.vercel.app' || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}
function json(res, status, body) {
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    .setHeader('Pragma', 'no-cache')
    .setHeader('Expires', '0');
  res.end(JSON.stringify(body));
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function publicProfile(profile) {
  const value = sanitizeProfile(profile.id, profile);
  delete value.password;
  delete value.passwordHash;
  return value;
}

function requirePassword(value) {
  const password = String(value || '');
  if (password.length < 6) {
    const error = new Error('auth/weak-password');
    error.status = 400;
    throw error;
  }
  return password;
}

function normalizedFirebaseError(error) {
  const rawCode = String(error && error.code != null ? error.code : '').toLowerCase();
  const rawMessage = String(error && error.message || '').toLowerCase();
  if (rawCode === '8' || rawCode.includes('resource-exhausted') || rawMessage.includes('resource exhausted') || rawMessage.includes('quota exceeded')) {
    return { code: 'firestore-resource-exhausted', status: 503, retryable: true };
  }
  if (rawCode === '4' || rawCode.includes('deadline-exceeded') || rawMessage.includes('deadline exceeded')) {
    return { code: 'firebase-deadline-exceeded', status: 503, retryable: true };
  }
  if (rawCode === '14' || rawCode.includes('unavailable') || rawMessage.includes('service unavailable')) {
    return { code: 'firebase-unavailable', status: 503, retryable: true };
  }
  if (rawCode === 'app/invalid-credential' || rawCode === 'server-misconfigured' || rawMessage.includes('invalid-credential') || rawMessage.includes('credentials are not configured')) {
    return { code: 'server-misconfigured', status: 503, retryable: false };
  }
  return { code: (error && (error.code || error.message)) || 'account-operation-failed', status: Number(error && error.status) || 500, retryable: false };
}

async function ensureNotLastManager(api, uid, nextRole, nextStatus) {
  const current = await readProfile(api, uid);
  if (!current || current.role !== 'مدير' || nextRole === 'مدير' && nextStatus !== 'موقوف') return;
  const profiles = await listProfiles(api);
  const activeManagers = profiles.filter(profile => profile.id !== String(uid) && profile.role === 'مدير' && profile.status !== 'موقوف');
  if (!activeManagers.length) {
    const error = new Error('cannot-remove-last-manager');
    error.status = 409;
    throw error;
  }
}

async function createAccount(api, input) {
  const username = String(input.username || '').trim().toLowerCase();
  const displayName = String(input.displayName || '').trim();
  const role = input.role === 'مدير' ? 'مدير' : 'موظف';
  const status = input.status === 'موقوف' ? 'موقوف' : 'نشط';
  if (!username || !displayName) {
    const error = new Error('missing-account-fields');
    error.status = 400;
    throw error;
  }
  const password = requirePassword(input.password);
  const authUser = await api.auth().createUser({
    email: authEmailForUsername(username),
    password,
    displayName,
    disabled: status === 'موقوف',
  });
  const now = new Date().toISOString();
  const profile = {
    id: authUser.uid,
    firebaseUid: authUser.uid,
    displayName,
    username,
    role,
    status,
    permissions: role === 'مدير' ? fullPermissions() : cleanPermissions(input.permissions),
    credentialVersion: 1,
    securityVersion: 1,
    createdAt: now.slice(0, 10),
    lastLogin: null,
    lastPasswordChangeAt: now,
    updatedAt: now,
  };
  try {
    await writeProfilePair(api, authUser.uid, profile);
  } catch (error) {
    await api.auth().deleteUser(authUser.uid).catch(() => {});
    throw error;
  }
  return profile;
}

async function updateAccount(api, input) {
  const uid = String(input.uid || '');
  if (!uid) {
    const error = new Error('missing-uid');
    error.status = 400;
    throw error;
  }
  const current = await readProfile(api, uid);
  if (!current) {
    const error = new Error('account-not-found');
    error.status = 404;
    throw error;
  }
  const nextRole = input.role === 'مدير' ? 'مدير' : (input.role === 'موظف' ? 'موظف' : current.role);
  const nextStatus = input.status === 'موقوف' ? 'موقوف' : (input.status === 'نشط' ? 'نشط' : current.status);
  await ensureNotLastManager(api, uid, nextRole, nextStatus);
  const now = new Date().toISOString();
  const password = String(input.password || '');
  const username = String(input.username || current.username).trim().toLowerCase();
  const displayName = String(input.displayName || current.displayName).trim();
  const sensitiveChange = password.length > 0 || nextRole !== current.role || nextStatus !== current.status || JSON.stringify(cleanPermissions(input.permissions || current.permissions)) !== JSON.stringify(cleanPermissions(current.permissions));
  const patch = {
    ...current,
    displayName,
    username,
    role: nextRole,
    status: nextStatus,
    permissions: nextRole === 'مدير' ? fullPermissions() : cleanPermissions(input.permissions || current.permissions),
    updatedAt: now,
  };
  if (sensitiveChange) {
    patch.credentialVersion = Number(current.credentialVersion || current.securityVersion || 1) + 1;
    patch.securityVersion = patch.credentialVersion;
  }
  if (password.length > 0) {
    requirePassword(password);
    patch.lastPasswordChangeAt = now;
  }
  const authPatch = { displayName, disabled: nextStatus === 'موقوف' };
  if (username && username !== current.username) authPatch.email = authEmailForUsername(username);
  if (password.length > 0) authPatch.password = password;
  // تعديل الصلاحيات لا يحتاج إلى استدعاء updateUser في Authentication؛ هذا
  // الاستدعاء الإضافي كان يوسع نافذة الفشل قبل حفظ Firestore. نُبقي إلغاء
  // الاعتماد بعد نجاح حفظ الوثائق فقط، بينما تغييرات كلمة المرور/الحالة/الاسم
  // تستمر في تحديث Authentication كالمعتاد.
  const authNeedsUpdate = input.action !== 'permissions' || password.length > 0 || username !== current.username || displayName !== current.displayName || nextStatus !== current.status;
  if (authNeedsUpdate) await api.auth().updateUser(uid, authPatch);
  const updated = await writeProfilePair(api, uid, patch);
  if (sensitiveChange) await api.auth().revokeRefreshTokens(uid);
  return updated;
}

const RECOVERY_DOC_ID = 'admin_manager';
function validRecoveryCode(value) {
  const code = String(value || '').trim();
  if (code.length < 10 || code.length > 64) throw Object.assign(new Error('recovery-code-invalid'), { status: 400 });
  return code;
}
function recoveryCollection(api) {
  return api.firestore().collection('_security');
}
async function configureManagerRecovery(api, managerUid, input) {
  const code = validRecoveryCode(input.recoveryCode);
  const salt = require('crypto').randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  await recoveryCollection(api).doc(RECOVERY_DOC_ID).set({
    uid: String(managerUid), username: 'admin', salt,
    codeHash: hashRecoveryCode(code, salt), attempts: 0, lockedUntil: 0,
    updatedAt: now, lastUsedAt: null,
  }, { merge: true });
  return { configured: true, updatedAt: now };
}
async function recoverManagerPassword(api, input) {
  const username = String(input.username || '').trim().toLowerCase();
  const code = validRecoveryCode(input.recoveryCode);
  const password = requirePassword(input.newPassword);
  if (username !== 'admin') throw Object.assign(new Error('invalid-recovery-code'), { status: 400 });
  const ref = recoveryCollection(api).doc(RECOVERY_DOC_ID);
  const snapshot = await ref.get();
  const recovery = snapshot.exists ? snapshot.data() : null;
  if (!recovery || !recovery.uid) throw Object.assign(new Error('recovery-not-configured'), { status: 409 });
  const nowMs = Date.now();
  if (Number(recovery.lockedUntil || 0) > nowMs) throw Object.assign(new Error('recovery-temporarily-locked'), { status: 429 });
  if (!recoveryCodeMatches(code, recovery.salt, recovery.codeHash)) {
    const attempts = Number(recovery.attempts || 0) + 1;
    await ref.set({ attempts, lockedUntil: attempts >= 5 ? nowMs + 15 * 60 * 1000 : 0, lastFailedAt: new Date(nowMs).toISOString() }, { merge: true });
    throw Object.assign(new Error('invalid-recovery-code'), { status: 400 });
  }
  const current = await readProfile(api, recovery.uid);
  if (!current || current.username !== 'admin' || current.role !== 'مدير' || current.status === 'موقوف') throw Object.assign(new Error('recovery-account-unavailable'), { status: 409 });
  const now = new Date().toISOString();
  const nextVersion = Number(current.credentialVersion || current.securityVersion || 1) + 1;
  await api.auth().updateUser(String(recovery.uid), { password });
  await api.auth().revokeRefreshTokens(String(recovery.uid));
  const updated = await writeProfilePair(api, recovery.uid, { ...current, credentialVersion: nextVersion, securityVersion: nextVersion, lastPasswordChangeAt: now, updatedAt: now });
  await ref.set({ attempts: 0, lockedUntil: 0, lastUsedAt: now }, { merge: true });
  return updated;
}

async function deleteAccount(api, input) {
  const uid = String(input.uid || '');
  if (!uid) throw Object.assign(new Error('missing-uid'), { status: 400 });
  const current = await readProfile(api, uid);
  let authUser = null;
  try {
    const authApi = api.auth();
    authUser = typeof authApi.getUser === 'function' ? await authApi.getUser(uid) : null;
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') authUser = null;
    else throw error;
  }

  // الحذف قابل لإعادة المحاولة: قد تكون محاولة سابقة قد حذفت الوثيقتين
  // أو مستخدم Authentication ثم انقطع الاتصال قبل تحديث واجهة المدير. لا
  // نعيد 404 في هذه الحالة، بل نعيد نجاحًا واضحًا كي يختفي الصف المحلي القديم.
  if (!current && !authUser) return { id: uid, alreadyRemoved: true };
  if (current) await ensureNotLastManager(api, uid, 'موظف', 'موقوف');

  const batch = api.firestore().batch();
  const usersRef = api.firestore().collection('users');
  const staffRef = api.firestore().collection('staff_accounts');
  batch.delete(usersRef.doc(uid));
  batch.delete(staffRef.doc(uid));
  // حذف أي نسخ legacy يكون معرّف مستندها محليًا، مع عدم لمس أي حساب آخر.
  for (const collectionRef of [usersRef, staffRef]) {
    const legacyMatches = await collectionRef.where('firebaseUid', '==', uid).get();
    for (const doc of legacyMatches.docs) {
      if (doc.id !== uid) batch.delete(doc.ref);
    }
  }
  await batch.commit();

  if (authUser) {
    try {
      await api.auth().deleteUser(uid);
    } catch (error) {
      // الوثائق حُذفت بالفعل؛ تسمح هذه المعالجة بإعادة المحاولة الآمنة إذا
      // كان مستخدم Authentication قد اختفى بين getUser وdeleteUser.
      if (!error || error.code !== 'auth/user-not-found') throw error;
    }
  }
  return { id: uid, alreadyRemoved: false };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  let input = {};
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
    input = bodyOf(req);
    if (req.method === 'POST' && input.action === 'recoverManagerPassword') {
      const api = getAdmin();
      const profile = await recoverManagerPassword(api, input);
      return json(res, 200, { ok: true, account: publicProfile(profile) });
    }
    const { api, uid: managerUid } = await requireManager(req);
    if (req.method === 'GET') return json(res, 200, { accounts: (await listProfiles(api)).map(publicProfile) });
    if (input.action === 'configureManagerRecovery') return json(res, 200, { ok: true, recovery: await configureManagerRecovery(api, managerUid, input) });
    let profile;
    if (input.action === 'create') profile = await createAccount(api, input);
    else if (input.action === 'update' || input.action === 'resetPassword' || input.action === 'toggleStatus' || input.action === 'permissions') profile = await updateAccount(api, input);
    else if (input.action === 'delete') return json(res, 200, { ok: true, deleted: await deleteAccount(api, input) });
    else return json(res, 400, { error: 'unknown-action' });
    return json(res, 200, { ok: true, account: publicProfile(profile) });
  } catch (error) {
    const info = normalizedFirebaseError(error);
    console.error('account-api-error', JSON.stringify({ action: input.action || '', code: error && error.code != null ? String(error.code) : '', message: String(error && error.message || '').slice(0, 240), normalized: info.code }));
    if (info.status === 503) res.setHeader('Retry-After', '30');
    return json(res, info.status, { error: info.code, retryable: info.retryable });
  }
};
