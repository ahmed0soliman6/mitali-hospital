const {
  getAdmin,
  authEmailForUsername,
  fullPermissions,
  readProfile,
  writeProfilePair,
} = require('../_lib/firebase-admin');

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin === 'null' || origin === 'https://mitali1.vercel.app' || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

function json(res, status, body) {
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    .end(JSON.stringify(body));
}

function bearerToken(req) {
  const header = String(req.headers && req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function ensureAdminProfile(api, decoded) {
  const current = await readProfile(api, decoded.uid);
  if (current) return current;
  for (const collectionName of ['users', 'staff_accounts']) {
    const legacySnapshot = await api.firestore().collection(collectionName)
      .where('username', '==', 'admin')
      .get();
    const legacy = legacySnapshot.docs.find(doc => String(doc.data().firebaseUid || '') === String(decoded.uid));
    if (legacy) {
      return writeProfilePair(api, decoded.uid, legacy.data());
    }
  }
  const authUser = await api.auth().getUser(decoded.uid);
  if (String(authUser.email || '').toLowerCase() !== authEmailForUsername('admin')) {
    const error = new Error('admin-profile-creation-not-allowed');
    error.status = 403;
    throw error;
  }
  return writeProfilePair(api, decoded.uid, {
    firebaseUid: decoded.uid,
    username: 'admin',
    displayName: 'مدير النظام',
    role: 'مدير',
    status: 'نشط',
    permissions: fullPermissions(),
    credentialVersion: 1,
    securityVersion: 1,
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
  try {
    const token = bearerToken(req);
    if (!token) return json(res, 401, { error: 'Authentication required' });
    const api = getAdmin();
    const decoded = await api.auth().verifyIdToken(token);
    const profile = await ensureAdminProfile(api, decoded);
    return json(res, 200, { ok: true, profile });
  } catch (error) {
    const status = Number(error && error.status) || (error && error.code === 'auth/id-token-expired' ? 401 : 500);
    console.error('auth-profile-error', JSON.stringify({ code: error && error.code || '', message: String(error && error.message || '').slice(0, 200) }));
    return json(res, status, { error: error && error.code || error && error.message || 'profile-operation-failed' });
  }
};

module.exports.ensureAdminProfile = ensureAdminProfile;
