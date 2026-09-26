const { getAdmin } = require('../_lib/firebase-admin');

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin === 'null' || origin === 'https://mitali1.vercel.app' || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
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
  const snapshot = await query.aggregate({
    total: api.firestore.AggregateField.sum('amount'),
    count: api.firestore.AggregateField.count(),
  }).get();
  const data = snapshot.data();
  return { total: Number(data.total || 0), count: Number(data.count || 0) };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' });
  const month = requestedMonth(req);
  if (!month) return json(res, 400, { error: 'invalid-month' });
  try {
    const api = getAdmin();
    await requireActiveUser(req, api);
    const [income, expense] = await Promise.all([
      aggregateCollection(api, 'income', month),
      aggregateCollection(api, 'expense', month),
    ]);
    return json(res, 200, {
      month,
      income,
      expense,
      totalIncome: income.total,
      totalExpense: expense.total,
      net: income.total - expense.total,
    });
  } catch (error) {
    const isMisconfigured = (error && (error.code === 'server-misconfigured' || error.code === 'app/invalid-credential')) || String(error && error.message || '').includes('credentials are not configured');
    const status = Number(error && error.status) || (isMisconfigured ? 503 : 500);
    console.error('financial-summary-error', String(error && error.code || error && error.message || 'unknown').slice(0, 180));
    return json(res, status, { error: isMisconfigured ? 'server-misconfigured' : (status >= 500 ? 'financial-summary-failed' : String(error.message || 'request-failed')) });
  }
};

module.exports.aggregateCollection = aggregateCollection;
module.exports.requestedMonth = requestedMonth;
