const adminLib = require('../_lib/firebase-admin');

let adminFirestore = null;
try {
  adminFirestore = require('firebase-admin/firestore');
} catch (_) {}

function getAggregateField(db) {
  if (adminFirestore && adminFirestore.AggregateField) {
    return adminFirestore.AggregateField;
  }
  try {
    const admin = require('../_lib/firebase-admin').getAdmin();
    if (admin && admin.firestore && admin.firestore.AggregateField) {
      return admin.firestore.AggregateField;
    }
  } catch (_) {}
  return null;
}

function setCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (
    origin === 'null' ||
    origin === 'https://mitali1.vercel.app' ||
    origin.endsWith('.vercel.app') ||
    (typeof process !== 'undefined' && process.env.ALLOW_RUN_APP_ORIGINS === '1' && origin.endsWith('.run.app')) ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1')
  ) {
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

const VISIT_COLLECTIONS = [
  { name: 'visits_clinic', kind: 'عيادات', kindKey: 'clinic' },
  { name: 'visits_dental', kind: 'أسنان', kindKey: 'dental' },
  { name: 'visits_operations', kind: 'عمليات', kindKey: 'operations' },
  { name: 'visits_labs', kind: 'تحاليل', kindKey: 'labs' },
  { name: 'visits_radiology', kind: 'أشعة', kindKey: 'radiology' },
];

const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

function doctorTypeUsesPercent(type) {
  return type === 'أسنان';
}

function percentShareForExam(doctor, examType) {
  if (!doctor) return { doc: 0, clinic: 0 };
  const isFollowup = examType === 'متابعة';
  return {
    doc: Number(isFollowup ? (doctor.docFollowupPct ?? doctor.docPct) : doctor.docPct) || 0,
    clinic: Number(isFollowup ? (doctor.clinicFollowupPct ?? doctor.clinicPct) : doctor.clinicPct) || 0,
  };
}

function clinicFeeForDoctor(doctor, examType) {
  if (!doctor) return 0;
  if (examType === 'متابعة') return Number(doctor.followupClinicFee) || 0;
  if (examType === 'استشارة') return Number(doctor.consultationClinicFee ?? doctor.checkupClinicFee) || 0;
  if (examType === 'جلسة') return Number(doctor.sessionClinicFee ?? doctor.checkupClinicFee) || 0;
  return Number(doctor.checkupClinicFee) || 0;
}

function computeShare(visit, doctor) {
  if (!doctor) return { doc: 0, clinic: 0 };
  const paid = Number(visit.paid) || 0;
  const mode = doctorTypeUsesPercent(doctor.type) ? 'percent' : (doctor.feeMode || 'fixed_visit');
  if (mode === 'fixed_daily') return { doc: 0, clinic: paid };
  if (mode === 'fixed_visit') {
    const hasSnapshot = visit.clinicFeeSnapshot !== undefined && visit.clinicFeeSnapshot !== null;
    const clinicFee = hasSnapshot ? Number(visit.clinicFeeSnapshot) : clinicFeeForDoctor(doctor, visit.examType);
    const clinicShare = Math.min(Math.max(clinicFee, 0), paid);
    return { doc: paid - clinicShare, clinic: clinicShare };
  }
  const pct = percentShareForExam(doctor, visit.examType);
  return { doc: paid * pct.doc, clinic: paid * pct.clinic };
}

function incomeDoctorShare(rec, doctor) {
  if (!rec || !rec.doctorId) return { doc: 0, clinic: 0 };
  if (rec.docShare !== undefined && rec.docShare !== null && rec.clinicShare !== undefined && rec.clinicShare !== null) {
    return { doc: Number(rec.docShare) || 0, clinic: Number(rec.clinicShare) || 0 };
  }
  if (!doctor) return { doc: 0, clinic: 0 };
  const amt = Number(rec.amount) || 0;
  const mode = doctorTypeUsesPercent(doctor.type) ? 'percent' : (doctor.feeMode || 'fixed_visit');
  if (mode === 'fixed_visit' || mode === 'fixed_daily') return { doc: 0, clinic: amt };
  const pct = percentShareForExam(doctor, 'كشف');
  return { doc: amt * pct.doc, clinic: amt * pct.clinic };
}

function doctorSettlementBreakdown(doctor, visits, lumpIncome, labExpense) {
  const d = doctor || {};
  const visitRows = Array.isArray(visits) ? visits : [];
  const incomeRows = Array.isArray(lumpIncome) ? lumpIncome : [];
  const grossRevenue = visitRows.reduce((s, v) => s + (Number(v.paid) || 0), 0)
    + incomeRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const lab = Number(labExpense) || 0;
  const activeDays = new Set([
    ...visitRows.map(v => v.date).filter(Boolean),
    ...incomeRows.map(r => r.date).filter(Boolean),
  ]);
  const mode = doctorTypeUsesPercent(d.type) ? 'percent' : (d.feeMode || 'fixed_visit');
  const visitShares = visitRows.reduce((s, v) => {
    const sh = computeShare(v, d);
    return { doc: s.doc + sh.doc, clinic: s.clinic + sh.clinic };
  }, { doc: 0, clinic: 0 });
  const incomeShares = incomeRows.reduce((s, r) => {
    const sh = incomeDoctorShare(r, d);
    return { doc: s.doc + sh.doc, clinic: s.clinic + sh.clinic };
  }, { doc: 0, clinic: 0 });
  const docShare = mode === 'fixed_daily'
    ? Math.max(0, Number(d.dailyFixedAmount) || 0) * activeDays.size
    : visitShares.doc + incomeShares.doc;
  const netRevenue = grossRevenue - lab;
  const clinicShare = netRevenue - docShare;
  return {
    mode,
    grossRevenue,
    labExpense: lab,
    netRevenue,
    docShare,
    clinicShare,
    activeDays: activeDays.size,
    visitCount: visitRows.length + incomeRows.length,
  };
}

function aggregateAccountingShares(visits, incomeRows, labExpenses, doctorsMap) {
  const visitList = Array.isArray(visits) ? visits : [];
  const incomeList = Array.isArray(incomeRows) ? incomeRows : [];
  const labList = Array.isArray(labExpenses) ? labExpenses : [];
  const doctorIds = new Set([
    ...visitList.map(v => v.doctorId).filter(Boolean),
    ...incomeList.map(r => r.doctorId).filter(Boolean),
  ]);
  let doc = 0, clinic = 0, gross = 0;
  const assignedVisitIds = new Set(), assignedIncomeIds = new Set();
  for (const doctorId of doctorIds) {
    const doctor = doctorsMap.get(doctorId);
    const dv = visitList.filter(v => v.doctorId === doctorId);
    const di = incomeList.filter(r => r.doctorId === doctorId);
    const labs = labList.filter(x => x.doctorId === doctorId);
    if (doctor) {
      const b = doctorSettlementBreakdown(doctor, dv, di, labs.reduce((s, x) => s + (Number(x.amount) || 0), 0));
      doc += b.docShare;
      clinic += b.clinicShare;
      gross += b.grossRevenue;
      dv.forEach(v => assignedVisitIds.add(v.id));
      di.forEach(r => assignedIncomeIds.add(r.id));
    }
  }
  for (const v of visitList) {
    if (!assignedVisitIds.has(v.id)) {
      const amount = Number(v.paid) || 0;
      gross += amount;
      clinic += amount;
    }
  }
  for (const r of incomeList) {
    if (!assignedIncomeIds.has(r.id)) {
      const amount = Number(r.amount) || 0;
      gross += amount;
      clinic += amount;
    }
  }
  return { gross, doc, clinic };
}

function patientKey(v) {
  const fn = (v.fileNo || '').trim();
  if (fn) return 'F:' + fn;
  return 'N:' + (v.patient || '').trim().toLowerCase() + '|' + (v.phone || '').trim();
}

async function computeDoctorReports(db, targetDoctorMonth) {
  const [docYear, docMonthStr] = targetDoctorMonth.split('-');
  const docLastDay = new Date(Date.UTC(Number(docYear), Number(docMonthStr), 0)).getUTCDate();
  const docStartDate = `${targetDoctorMonth}-01`;
  const docEndDate = `${targetDoctorMonth}-${String(docLastDay).padStart(2, '0')}`;

  const [doctorsSnap, doctorVisitSnaps, doctorIncomeSnap, doctorLabSnap] = await Promise.all([
    db.collection('doctors').get(),
    Promise.all(
      VISIT_COLLECTIONS.map(c =>
        db.collection(c.name)
          .where('date', '>=', docStartDate)
          .where('date', '<=', docEndDate)
          .select('date', 'paid', 'doctorId', 'examType', 'clinicFeeSnapshot')
          .get()
      )
    ),
    db.collection('income')
      .where('date', '>=', docStartDate)
      .where('date', '<=', docEndDate)
      .get(),
    db.collection('lab_expenses')
      .where('month', '==', targetDoctorMonth)
      .get()
      .catch(() => ({ docs: [] })),
  ]);

  const doctors = doctorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const doctorsMap = new Map(doctors.map(d => [d.id, d]));

  const doctorVisits = [];
  VISIT_COLLECTIONS.forEach((c, idx) => {
    doctorVisitSnaps[idx].docs.forEach(d => {
      doctorVisits.push({ id: d.id, ...d.data(), kind: c.kind, kindKey: c.kindKey });
    });
  });

  const doctorIncomeRows = doctorIncomeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const doctorLumpIncome = doctorIncomeRows.filter(r => r.doctorId);
  const doctorLabs = doctorLabSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const byDoctor = doctors.map(d => {
    const dv = doctorVisits.filter(v => v.doctorId === d.id);
    const di = doctorLumpIncome.filter(r => r.doctorId === d.id);
    const dl = doctorLabs.filter(x => x.doctorId === d.id);
    const breakdown = doctorSettlementBreakdown(d, dv, di, dl.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    return {
      doctorId: d.id,
      name: d.name,
      specialty: d.specialty || '',
      type: d.type,
      count: breakdown.visitCount,
      rev: breakdown.grossRevenue,
      grossRevenue: breakdown.grossRevenue,
      labExpense: breakdown.labExpense,
      netRevenue: breakdown.netRevenue,
      doc: breakdown.docShare,
      docShare: breakdown.docShare,
      clinic: breakdown.clinicShare,
      clinicShare: breakdown.clinicShare,
      mode: breakdown.mode
    };
  }).filter(r => r.count > 0 || r.labExpense > 0).sort((a, b) => b.rev - a.rev);

  const bySpecialty = {};
  doctorVisits.forEach(v => {
    const d = doctorsMap.get(v.doctorId);
    const spec = d ? (d.specialty || 'غير محدد') : 'غير محدد';
    bySpecialty[spec] = (bySpecialty[spec] || 0) + (Number(v.paid) || 0);
  });

  const totals = byDoctor.reduce((s, r) => ({
    gross: s.gross + r.grossRevenue,
    lab: s.lab + r.labExpense,
    net: s.net + r.netRevenue,
    doc: s.doc + r.docShare,
    clinic: s.clinic + r.clinicShare,
    count: s.count + r.count
  }), { gross: 0, lab: 0, net: 0, doc: 0, clinic: 0, count: 0 });

  return {
    doctorMonth: targetDoctorMonth,
    byDoctor,
    bySpecialty,
    totals,
    _raw: {
      doctors,
      doctorsMap,
      doctorVisits,
      doctorIncomeRows,
      doctorLabs
    }
  };
}

async function computeReports(db, { range, closingMonth, annualYear, doctorMonth, includeAnnual }) {
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const targetClosingMonth = /^\d{4}-\d{2}$/.test(closingMonth) ? closingMonth : currentYM;
  const targetAnnualYear = /^\d{4}$/.test(annualYear) ? annualYear : String(now.getFullYear());
  const targetDoctorMonth = /^\d{4}-\d{2}$/.test(doctorMonth) ? doctorMonth : currentYM;
  const shouldComputeAnnual = includeAnnual === true || includeAnnual === '1' || includeAnnual === 'true';

  const Agg = getAggregateField(db);

  // 1. Fetch settings (opening balance)
  const settingsDoc = await db.collection('settings').doc('app').get();
  const openingBalance = Number(settingsDoc.exists ? settingsDoc.data().openingBalance : 0) || 0;

  // 2. Compute doctor reports for targetDoctorMonth
  const docCacheKey = `scope:doctors:${targetDoctorMonth}`;
  let docReports;
  const cachedDoc = REPORTS_SERVER_CACHE.get(docCacheKey);
  if (cachedDoc && (Date.now() - cachedDoc.timestamp < REPORTS_CACHE_TTL_MS) && cachedDoc.raw) {
    docReports = cachedDoc.raw;
  } else {
    docReports = await computeDoctorReports(db, targetDoctorMonth);
    REPORTS_SERVER_CACHE.set(docCacheKey, {
      timestamp: Date.now(),
      data: {
        doctorMonth: docReports.doctorMonth,
        byDoctor: docReports.byDoctor,
        bySpecialty: docReports.bySpecialty,
        totals: docReports.totals
      },
      raw: docReports
    });
  }
  const byDoctor = docReports.byDoctor;
  const bySpecialty = docReports.bySpecialty;
  const doctors = docReports._raw.doctors;
  const doctorsMap = docReports._raw.doctorsMap;

  // 3. Closing Month Data (targetClosingMonth)
  const [closeYear, closeMonthStr] = targetClosingMonth.split('-');
  const closeLastDay = new Date(Date.UTC(Number(closeYear), Number(closeMonthStr), 0)).getUTCDate();
  const closeStartDate = `${targetClosingMonth}-01`;
  const closeEndDate = `${targetClosingMonth}-${String(closeLastDay).padStart(2, '0')}`;

  let closingVisits;
  let closingIncomeRows;
  let closingLabRows;

  if (targetClosingMonth === targetDoctorMonth) {
    closingVisits = docReports._raw.doctorVisits;
    closingIncomeRows = docReports._raw.doctorIncomeRows;
    closingLabRows = docReports._raw.doctorLabs;
  } else {
    const [cVisitsSnaps, cIncSnap, cLabSnap] = await Promise.all([
      Promise.all(
        VISIT_COLLECTIONS.map(c =>
          db.collection(c.name)
            .where('date', '>=', closeStartDate)
            .where('date', '<=', closeEndDate)
            .select('date', 'paid', 'doctorId', 'examType', 'clinicFeeSnapshot')
            .get()
        )
      ),
      db.collection('income').where('date', '>=', closeStartDate).where('date', '<=', closeEndDate).get(),
      db.collection('lab_expenses').where('month', '==', targetClosingMonth).get().catch(() => ({ docs: [] })),
    ]);
    closingVisits = [];
    VISIT_COLLECTIONS.forEach((c, idx) => {
      cVisitsSnaps[idx].docs.forEach(d => {
        closingVisits.push({ id: d.id, ...d.data(), kind: c.kind, kindKey: c.kindKey });
      });
    });
    closingIncomeRows = cIncSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    closingLabRows = cLabSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  let openingIncTotal = 0;
  let openingExpTotal = 0;
  try {
    const fetchOpening = async () => {
      if (Agg) {
        const [oIncSnap, oExpSnap] = await Promise.all([
          db.collection('income').where('date', '<', closeStartDate).aggregate({ total: Agg.sum('amount') }).get(),
          db.collection('expense').where('date', '<', closeStartDate).aggregate({ total: Agg.sum('amount') }).get(),
        ]);
        return {
          inc: Number(oIncSnap.data().total || 0),
          exp: Number(oExpSnap.data().total || 0)
        };
      } else if (typeof db.collection('income').where('date', '<', closeStartDate).aggregate === 'function') {
        const [oIncSnap, oExpSnap] = await Promise.all([
          db.collection('income').where('date', '<', closeStartDate).aggregate({ total: 'amount' }).get(),
          db.collection('expense').where('date', '<', closeStartDate).aggregate({ total: 'amount' }).get(),
        ]);
        return {
          inc: Number(oIncSnap.data().total || 0),
          exp: Number(oExpSnap.data().total || 0)
        };
      }
      return { inc: 0, exp: 0 };
    };

    let timer;
    const timeoutPromise = new Promise(resolve => { timer = setTimeout(() => resolve({ inc: 0, exp: 0 }), 2500); });
    const res = await Promise.race([fetchOpening(), timeoutPromise]);
    clearTimeout(timer);
    openingIncTotal = res.inc;
    openingExpTotal = res.exp;
  } catch (aggErr) {
    console.warn('Opening balance aggregation skipped:', aggErr?.message || aggErr);
  }

  const [closingExpSnap, closingPayrollSnap] = await Promise.all([
    db.collection('expense').where('date', '>=', closeStartDate).where('date', '<=', closeEndDate).get(),
    db.collection('payroll').where('month', '==', targetClosingMonth).get(),
  ]);

  const closingExpenseRows = closingExpSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const closingPayrollRows = closingPayrollSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const closingVisitRevenue = closingVisits.reduce((s, v) => s + (Number(v.paid) || 0), 0);
  const closingShares = aggregateAccountingShares(closingVisits, closingIncomeRows, closingLabRows, doctorsMap);

  const closingIncomeByCat = {};
  closingIncomeRows.forEach(x => {
    const cat = x.category || 'غير مصنّف';
    closingIncomeByCat[cat] = (closingIncomeByCat[cat] || 0) + (Number(x.amount) || 0);
  });

  const closingExpenseByCat = {};
  closingExpenseRows.forEach(x => {
    const cat = x.category || 'غير مصنّف';
    closingExpenseByCat[cat] = (closingExpenseByCat[cat] || 0) + (Number(x.amount) || 0);
  });

  const closingTotalIncome = closingIncomeRows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const closingTotalExpense = closingExpenseRows.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const openingOfMonth = openingBalance + openingIncTotal - openingExpTotal;
  const closingBalance = openingOfMonth + closingTotalIncome - closingTotalExpense;

  const payrollPaid = closingPayrollRows.filter(p => p.status === 'تم').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const payrollDue = closingPayrollRows.filter(p => p.status !== 'تم').reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const closing = {
    ym: targetClosingMonth,
    visitCount: closingVisits.length,
    visitRevenue: closingVisitRevenue,
    docShare: closingShares.doc,
    clinicShare: closingShares.clinic,
    incomeByCat: closingIncomeByCat,
    expenseByCat: closingExpenseByCat,
    totalIncome: closingTotalIncome,
    totalExpense: closingTotalExpense,
    openingOfMonth,
    closingBalance,
    net: closingTotalIncome - closingTotalExpense,
    payrollPaid,
    payrollDue,
    payrollCount: closingPayrollRows.length,
  };

  // 6. تم إلغاء استعلامات الشهور السابقة وبطاقة الـ 6 شهور بالكامل لتفادي استنزاف الحصة (Error 8)
  const monthlyRows = [];

  // 7. Annual Report
  const curYear = now.getFullYear();
  const availableYears = [String(curYear), String(curYear - 1), String(curYear - 2), String(curYear - 3)];
  if (!availableYears.includes(targetAnnualYear)) {
    availableYears.push(targetAnnualYear);
    availableYears.sort().reverse();
  }

  let annual;
  if (!shouldComputeAnnual) {
    annual = {
      year: targetAnnualYear,
      totalIncome: 0,
      totalExpense: 0,
      netProfit: 0,
      uniquePatients: 0,
      clinicVisitsCount: 0,
      dentalVisitsCount: 0,
      byCategorySorted: [],
      byDoctorYear: [],
      availableYears,
      loaded: false,
    };
  } else {
    const [annualIncSnap, annualExpSnap, annualVisitSnaps] = await Promise.all([
      db.collection('income').where('date', '>=', `${targetAnnualYear}-01-01`).where('date', '<=', `${targetAnnualYear}-12-31`).select('amount', 'category').get(),
      db.collection('expense').where('date', '>=', `${targetAnnualYear}-01-01`).where('date', '<=', `${targetAnnualYear}-12-31`).select('amount', 'category').get(),
      Promise.all(
        VISIT_COLLECTIONS.map(c =>
          db.collection(c.name)
            .where('date', '>=', `${targetAnnualYear}-01-01`)
            .where('date', '<=', `${targetAnnualYear}-12-31`)
            .select('date', 'paid', 'doctorId', 'patient', 'fileNo', 'phone')
            .get()
        )
      ),
    ]);

    const annualIncomeRows = annualIncSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const annualExpenseRows = annualExpSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const annualYearVisits = [];
    VISIT_COLLECTIONS.forEach((c, idx) => {
      annualVisitSnaps[idx].docs.forEach(d => {
        annualYearVisits.push({ id: d.id, ...d.data(), kind: c.kind, kindKey: c.kindKey });
      });
    });

    const annualTotalIncome = annualIncomeRows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const annualTotalExpense = annualExpenseRows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const annualNetProfit = annualTotalIncome - annualTotalExpense;

    const annualClinicVisitsCount = annualYearVisits.filter(v => v.kind === 'عيادات').length;
    const annualDentalVisitsCount = annualYearVisits.filter(v => v.kind === 'أسنان').length;

    const uniquePatientsMap = new Map();
    annualYearVisits.forEach(v => {
      const k = patientKey(v);
      if (!uniquePatientsMap.has(k)) uniquePatientsMap.set(k, true);
    });
    const annualUniquePatients = uniquePatientsMap.size;

    const annualByDoctor = doctors.map(d => {
      const dv = annualYearVisits.filter(v => v.doctorId === d.id);
      const rev = dv.reduce((s, v) => s + (Number(v.paid) || 0), 0);
      return { name: d.name, type: d.type, count: dv.length, rev };
    }).filter(r => r.count > 0).sort((a, b) => b.rev - a.rev);

    const annualByCategory = {};
    annualIncomeRows.forEach(x => {
      const cat = x.category || 'غير مصنّف';
      annualByCategory[cat] = (annualByCategory[cat] || 0) + (Number(x.amount) || 0);
    });
    const annualByCategorySorted = Object.entries(annualByCategory).sort((a, b) => b[1] - a[1]);

    annual = {
      year: targetAnnualYear,
      totalIncome: annualTotalIncome,
      totalExpense: annualTotalExpense,
      netProfit: annualNetProfit,
      uniquePatients: annualUniquePatients,
      clinicVisitsCount: annualClinicVisitsCount,
      dentalVisitsCount: annualDentalVisitsCount,
      byCategorySorted: annualByCategorySorted,
      byDoctorYear: annualByDoctor,
      availableYears,
      loaded: true,
    };
  }

  return {
    range,
    closingMonth: targetClosingMonth,
    annualYear: targetAnnualYear,
    doctorMonth: targetDoctorMonth,
    availableYears,
    monthlyRows,
    byDoctor,
    bySpecialty,
    closing,
    annual,
  };
}

const REPORTS_SERVER_CACHE = new Map();
const REPORTS_CACHE_TTL_MS = 90 * 1000;

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' });

  const scope = String(req.query.scope || '');
  const range = String(req.query.range || '6');
  const closingMonth = String(req.query.closingMonth || '');
  const annualYear = String(req.query.annualYear || '');
  const doctorMonth = String(req.query.doctorMonth || req.query.month || '');
  const includeAnnual = req.query.includeAnnual != null ? String(req.query.includeAnnual) : undefined;

  if (scope === 'doctors') {
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetDoctorMonth = /^\d{4}-\d{2}$/.test(doctorMonth) ? doctorMonth : currentYM;
    const cacheKey = `scope:doctors:${targetDoctorMonth}`;

    const cached = REPORTS_SERVER_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < REPORTS_CACHE_TTL_MS) {
      return json(res, 200, cached.data);
    }

    try {
      const api = adminLib.getAdmin();
      await requireActiveUser(req, api);

      const data = await computeDoctorReports(api.firestore(), targetDoctorMonth);
      const rawData = Object.assign({}, data);
      delete data._raw;
      REPORTS_SERVER_CACHE.set(cacheKey, { timestamp: Date.now(), data, raw: rawData });
      return json(res, 200, data);
    } catch (error) {
      return handleReportError(res, error);
    }
  }

  const cacheKey = `${range}|${closingMonth}|${annualYear}|${doctorMonth}|${includeAnnual}`;

  const cached = REPORTS_SERVER_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REPORTS_CACHE_TTL_MS) {
    return json(res, 200, cached.data);
  }

  try {
    const api = adminLib.getAdmin();
    await requireActiveUser(req, api);

    const data = await computeReports(api.firestore(), { range, closingMonth, annualYear, doctorMonth, includeAnnual });
    REPORTS_SERVER_CACHE.set(cacheKey, { timestamp: Date.now(), data });
    return json(res, 200, data);
  } catch (error) {
    return handleReportError(res, error);
  }
};

function handleReportError(res, error) {
  const rawCode = String(error && error.code != null ? error.code : '');
  const rawMessage = String(error && error.message || '');
  const isResourceExhausted =
    rawCode === '8' ||
    rawCode.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.includes('Quota exceeded');

  if (isResourceExhausted) {
    console.warn('financial-reports: firestore-resource-exhausted');
    return json(res, 503, {
      error: 'firestore-resource-exhausted',
      retryable: true
    });
  }

  const isMisconfigured =
    rawCode === 'server-misconfigured' ||
    rawCode === 'app/invalid-credential' ||
    rawCode === '7' ||
    rawCode.includes('permission-denied') ||
    rawMessage.includes('credentials are not configured') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('Missing or insufficient permissions');

  const status = Number(error && error.status) || (isMisconfigured ? 503 : 500);
  if (!isMisconfigured) {
    console.error('financial-reports-error', String(error && error.code || error && error.message || 'unknown').slice(0, 180));
  }
  return json(res, status, {
    error: isMisconfigured ? 'server-misconfigured' : (status >= 500 ? 'financial-reports-failed' : String(error.message || 'request-failed'))
  });
}

module.exports.computeReports = computeReports;
module.exports.computeDoctorReports = computeDoctorReports;
