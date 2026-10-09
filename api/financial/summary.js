const { getAdmin } = require('../_lib/firebase-admin');

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin === 'null' || origin === 'https://mitali1.vercel.app' || origin.endsWith('.vercel.app') || (typeof process !== 'undefined' && process.env.ALLOW_RUN_APP_ORIGINS === '1' && origin.endsWith('.run.app')) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requestedMonth(req) {
  const value = String((req.query && req.query.month) || 'all');
  if (value === 'all' || /^\d{4}-\d{2}$/.test(value)) return value;
  return null;
}

async function requireActiveUser(req, api) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  const decoded = await api.auth().verifyIdToken(token);
  const profile = await api.firestore().collection('users').doc(decoded.uid).get();
  if (!profile.exists || profile.data().status === 'موقوف') {
    const error = new Error('Active user access required');
    error.status = 403;
    throw error;
  }
  return decoded;
}

async function aggregateCollection(api, name, month) {
  let query = api.firestore().collection(name);
  if (month !== 'all') {
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    query = query
      .where('date', '>=', `${month}-01`)
      .where('date', '<=', `${month}-${String(lastDay).padStart(2, '0')}`);
  }
  try {
    const snapshot = await query.aggregate({
      total: api.firestore.AggregateField.sum('amount'),
      count: api.firestore.AggregateField.count(),
    }).get();
    const data = snapshot.data();
    return { total: Number(data.total || 0), count: Number(data.count || 0) };
  } catch (err) {
    const rawCode = String(err && (err.code != null ? err.code : ''));
    if (rawCode === '9' || rawCode.includes('FAILED_PRECONDITION')) {
      console.warn('[financial-summary] missing composite index, falling back to in-memory sum', name, month);
      const snap = typeof query.select === 'function' ? await query.select('amount').get() : await query.get();
      let total = 0;
      let count = 0;
      if (snap && typeof snap.forEach === 'function') {
        snap.forEach(doc => {
          count++;
          const d = doc.data ? doc.data() : doc;
          const amt = Number(d && d.amount);
          if (!isNaN(amt)) total += amt;
        });
      } else if (snap && Array.isArray(snap.docs)) {
        count = snap.docs.length;
        for (const doc of snap.docs) {
          const d = doc.data ? doc.data() : doc;
          const amt = Number(d && d.amount);
          if (!isNaN(amt)) total += amt;
        }
      }
      return { total, count };
    }
    throw err;
  }
}

const SUMMARY_CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000;

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' });
  const month = requestedMonth(req);
  if (!month) return json(res, 400, { error: 'invalid-month' });

  const cached = SUMMARY_CACHE.get(month);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return json(res, 200, cached.data);
  }

  try {
    const api = getAdmin();
    await requireActiveUser(req, api);
    const [income, expense] = await Promise.all([
      aggregateCollection(api, 'income', month),
      aggregateCollection(api, 'expense', month),
    ]);
    const responseData = {
      month,
      income,
      expense,
      totalIncome: income.total,
      totalExpense: expense.total,
      net: income.total - expense.total,
    };
    SUMMARY_CACHE.set(month, { timestamp: Date.now(), data: responseData });
    return json(res, 200, responseData);
  } catch (error) {
    const rawCode = String(error && error.code != null ? error.code : '');
    const rawMessage = String(error && error.message || '');

    const isResourceExhausted =
      rawCode === '8' ||
      rawCode.includes('RESOURCE_EXHAUSTED') ||
      rawMessage.includes('RESOURCE_EXHAUSTED') ||
      rawMessage.includes('Quota exceeded');

    if (isResourceExhausted) {
      console.warn('financial-summary: firestore-resource-exhausted');
      return json(res, 503, {
        error: 'firestore-resource-exhausted',
        retryable: true
      });
    }

    const isMisconfigured = (error && (rawCode === 'server-misconfigured' || rawCode === 'app/invalid-credential' || rawCode === '7' || rawCode.includes('permission-denied'))) || rawMessage.includes('credentials are not configured') || rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('Missing or insufficient permissions');
    const status = Number(error && error.status) || (isMisconfigured ? 503 : 500);
    if (!isMisconfigured) {
      console.error('financial-summary-error', String(error && error.code || error && error.message || 'unknown').slice(0, 180));
    }
    return json(res, status, { error: isMisconfigured ? 'server-misconfigured' : (status >= 500 ? 'financial-summary-failed' : String(error.message || 'request-failed')) });
  }
};

module.exports.aggregateCollection = aggregateCollection;
module.exports.requestedMonth = requestedMonth;
