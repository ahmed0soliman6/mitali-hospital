/*
 * Mitali Hospital — Firebase Firestore adapter
 *
 * Firestore is the only remote data source used by the main app. Authentication
 * is handled by Firebase Auth, while data and user profiles are stored in Firestore.
 * No Admin SDK or service-account credential belongs in this file.
 */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyCPfbtk7Sodm6eAzDoFx-AbrrhfHGlOemE",
    authDomain: "mitali-hospital.firebaseapp.com",
    projectId: "mitali-hospital",
    storageBucket: "mitali-hospital.firebasestorage.app",
    messagingSenderId: "285647848005",
    appId: "1:285647848005:web:33834414233c404781592c",
    measurementId: "G-MSXFTKDVKW"
  };

  const COLLECTIONS = {
    doctors: "doctors",
    employees: "employees",
    visitsClinic: "visits_clinic",
    visitsDental: "visits_dental",
    visitsOperations: "visits_operations",
    visitsLabs: "visits_labs",
    visitsRadiology: "visits_radiology",
    income: "income",
    expense: "expense",
    payroll: "payroll",
    // users هو مصدر الحقيقة الوحيد للحسابات والصلاحيات.
    staffAccounts: "users",
    auditLog: "audit_log",
    labExpenses: "lab_expenses",
    categories: "categories",
    specialties: "specialties",
    settings: "settings",
    systemControl: "system_control"
  };

  let app = null;
  let db = null;
  let auth = null;
  let secondaryApp = null;
  let secondaryAuth = null;
  let persistencePromise = null;
  let authReadyPromise = null;

  function init() {
    if (db) return db;
    if (!window.firebase || !window.firebase.initializeApp || !window.firebase.firestore) {
      throw new Error("Firebase Web SDK is not loaded");
    }
    app = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    db = window.firebase.firestore(app);
    auth = window.firebase.auth ? window.firebase.auth(app) : null;
    if (auth && auth.onAuthStateChanged) {
      authReadyPromise = new Promise((resolve) => {
        let unsubscribe = null;
        unsubscribe = auth.onAuthStateChanged((user) => {
          if (unsubscribe) unsubscribe();
          resolve(user || null);
        });
      });
    } else {
      authReadyPromise = Promise.resolve(null);
    }
    persistencePromise = db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
      // Persistence may be unavailable when another tab owns the lease or when
      // the browser blocks IndexedDB. Firestore still works online in that case.
      console.warn("Firestore persistence unavailable; continuing online:", error.code || error.message || error);
    });
    return db;
  }

  async function ready() {
    init();
    await persistencePromise;
    return true;
  }

  async function waitForAuth(timeoutMs = 5000) {
    init();
    if (!authReadyPromise) return null;
    const wait = authReadyPromise;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1000, Number(timeoutMs) || 5000)));
    return await Promise.race([wait, timeout]);
  }

  function collectionName(key) {
    const name = COLLECTIONS[key];
    if (!name) throw new Error(`Unknown Firestore collection: ${key}`);
    return name;
  }

  function cleanDocument(value) {
    if (Array.isArray(value)) return value.map(cleanDocument);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // Firestore rejects undefined values. Null is intentional and preserved.
      if (item !== undefined) out[key] = cleanDocument(item);
    }
    return out;
  }

  function safeRecord(key, record) {
    const data = Object.assign({}, record || {});
    // Passwords belong only to Firebase Authentication and must never be copied
    // into Firestore during the migration.
    if (key === "staffAccounts") { delete data.password; delete data.passwordHash; }
    return cleanDocument(data);
  }

  async function commitOperations(operations) {
    const CHUNK = 400;
    for (let i = 0; i < operations.length; i += CHUNK) {
      const batch = db.batch();
      operations.slice(i, i + CHUNK).forEach((operation) => {
        if (operation.type === "delete") batch.delete(operation.ref);
        else batch.set(operation.ref, operation.data, { merge: false });
      });
      await batch.commit();
    }
  }

  function authEmailForUsername(username) {
    const encoded = btoa(unescape(encodeURIComponent(String(username || '').trim().toLowerCase())))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `u-${encoded}@accounts.mitali-hospital.internal`;
  }

  async function signInWithUsername(username, password) {
    init();
    if (!auth) throw new Error('Firebase Authentication SDK is not loaded');
    return auth.signInWithEmailAndPassword(authEmailForUsername(username), password);
  }

  async function createAuthUserForUsername(username, password) {
    init();
    if (!auth) throw new Error('Firebase Authentication SDK is not loaded');
    // Use a secondary Firebase app so creating a staff account does not replace
    // the currently signed-in administrator session in the primary app.
    if (!secondaryApp) secondaryApp = window.firebase.initializeApp(firebaseConfig, 'MitaliStaffAccountCreator');
    if (!secondaryAuth) secondaryAuth = secondaryApp.auth();
    try {
      return await secondaryAuth.createUserWithEmailAndPassword(authEmailForUsername(username), password);
    } finally {
      try { await secondaryAuth.signOut(); } catch (e) { /* ignore */ }
    }
  }

  async function changePassword(username, currentPassword, newPassword) {
    await ready();
    if (!auth || !auth.currentUser) throw new Error('Firebase user is not authenticated');
    if (!currentPassword || !newPassword || String(newPassword).length < 6) throw new Error('auth/weak-password');
    const email = authEmailForUsername(username);
    const credential = window.firebase.auth.EmailAuthProvider.credential(email, currentPassword);
    await auth.currentUser.reauthenticateWithCredential(credential);
    await auth.currentUser.updatePassword(String(newPassword));
    return true;
  }

  const API_BASE = String(window.MITALI_API_BASE || "").replace(/\/$/, "");
  function apiUrl(path) { return API_BASE + path; }

  async function adminAccountRequest(payload) {
    init();
    if (!auth || !auth.currentUser) throw new Error('auth/not-authenticated');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(apiUrl('/api/admin/account'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload || {})
    });
    let body = null;
    try { body = await response.json(); } catch (e) { body = null; }
    if (!response.ok) {
      const error = new Error((body && body.error) || `admin-api-${response.status}`);
      error.code = (body && body.error) || `admin-api-${response.status}`;
      throw error;
    }
    return body;
  }

  async function adminCreateAccount(payload) {
    return adminAccountRequest(Object.assign({ action: 'create' }, payload || {}));
  }

  async function configureManagerRecovery(payload) {
    return adminAccountRequest(Object.assign({ action: 'configureManagerRecovery' }, payload || {}));
  }

  async function recoverManagerPassword(payload) {
    init();
    const response = await fetch(apiUrl('/api/admin/account'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: 'recoverManagerPassword' }, payload || {}))
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `admin-recovery-${response.status}`);
      error.code = body.error || `admin-recovery-${response.status}`;
      throw error;
    }
    return body;
  }

  async function adminUpdateAccount(payload, action = 'update') {
    return adminAccountRequest(Object.assign({ action }, payload || {}));
  }

  async function adminListAccounts() {
    init();
    if (!auth || !auth.currentUser) throw new Error('auth/not-authenticated');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(apiUrl('/api/admin/account'), { headers: { 'Authorization': `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `admin-api-${response.status}`), { code: body.error });
    return body.accounts || [];
  }

  async function adminDeleteAccount(uid) {
    return adminAccountRequest({ action: 'delete', uid: String(uid || '') });
  }

  async function adminWipeBusinessData(confirmationText) {
    init();
    if (!auth || !auth.currentUser) throw new Error('auth/not-authenticated');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(apiUrl('/api/admin/data'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'wipeBusinessData', confirmationText: String(confirmationText || '') })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `data-wipe-${response.status}`);
      error.code = body.error || `data-wipe-${response.status}`;
      error.requiredPhrase = body.requiredPhrase || '';
      throw error;
    }
    return body;
  }

  async function signOut() {
    init();
    if (auth) await auth.signOut();
  }

  function authUser() {
    init();
    return auth ? auth.currentUser : null;
  }

  async function getUserProfile(uid, options = {}) {
    await ready();
    if (!auth || !auth.currentUser || auth.currentUser.uid !== uid) throw new Error('Firebase user is not authenticated');
    const ref = db.collection('users').doc(String(uid));
    const snap = options && options.source ? await ref.get({ source: options.source }) : await ref.get();
    return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
  }

  async function updateOwnSecurityMetadata(metadata) {
    await ready();
    if (!auth || !auth.currentUser) throw new Error('Firebase user is not authenticated');
    const data = cleanDocument(Object.assign({}, metadata || {}));
    delete data.id;
    delete data.password;
    delete data.role;
    delete data.status;
    delete data.username;
    delete data.firebaseUid;
    await db.collection('users').doc(String(auth.currentUser.uid)).set(data, { merge: true });
    return data;
  }

  async function setUserProfile(uid, profile) {
    await ready();
    if (!auth || !auth.currentUser) throw new Error('Firebase administrator is not authenticated');
    const data = cleanDocument(Object.assign({}, profile || {}));
    delete data.id;
    delete data.password;
    delete data.firebaseUid;
    await db.collection('users').doc(String(uid)).set(data, { merge: false });
    return Object.assign({ id: String(uid) }, data);
  }

  async function deleteUserProfile(uid) {
    await ready();
    if (!auth || !auth.currentUser) throw new Error('Firebase administrator is not authenticated');
    await db.collection('users').doc(String(uid)).delete();
    return true;
  }

  const READ_METRICS = { queries: 0, documents: 0, byKey: Object.create(null), lastReadAt: null };
  function recordReadMetric(key, count) {
    READ_METRICS.queries += 1;
    READ_METRICS.documents += Number(count || 0);
    const name = String(key || "unknown");
    READ_METRICS.byKey[name] = Number(READ_METRICS.byKey[name] || 0) + Number(count || 0);
    READ_METRICS.lastReadAt = new Date().toISOString();
  }
  function getReadMetrics() {
    return JSON.parse(JSON.stringify(READ_METRICS));
  }
  function resetReadMetrics() {
    READ_METRICS.queries = 0;
    READ_METRICS.documents = 0;
    READ_METRICS.byKey = Object.create(null);
    READ_METRICS.lastReadAt = null;
  }
  async function getTable(key, options = {}) {
    await ready();
    const query = db.collection(collectionName(key));
    const snap = options && options.source ? await query.get({ source: options.source }) : await query.get();
    recordReadMetric(key, snap.docs.length);
    return snap.docs.map((doc) => {
      const record = Object.assign({ id: doc.id }, doc.data());
      if (key === "staffAccounts") { delete record.password; delete record.passwordHash; }
      return record;
    });
  }

  async function getValue(key, fallback, options = {}) {
    const records = await getTable(key, options);
    if (!records.length) return fallback;
    if (key === "specialties") {
      const raw = Object.assign({}, records[0]);
      delete raw.id;
      if (Array.isArray(raw.value)) return raw.value;
      // Support the first migration format, which spread an array into
      // numeric document fields ("0", "1", ...).
      const numericKeys = Object.keys(raw)
        .filter((field) => /^\d+$/.test(field))
        .sort((a, b) => Number(a) - Number(b));
      return numericKeys.length ? numericKeys.map((field) => raw[field]) : fallback;
    }
    if (key === "settings" || key === "categories") {
      const value = Object.assign({}, records[0]);
      delete value.id;
      return value;
    }
    return records;
  }

  async function setValue(key, value) {
    // هذه الجداول الثلاثة تُخزَّن منطقيًا في وثيقة واحدة باسم app. استخدام
    // upsertRecord هنا يتجنب collection.get() الكامل في كل تغيير للإعدادات
    // أو أنواع التخصصات، مع إبقاء setTable متاحًا للهجرة/الاستعادة الكاملة.
    if (key === "specialties") {
      return upsertRecord(key, { id: "app", value: Array.isArray(value) ? value : [] });
    }
    if (key === "settings" || key === "categories") {
      return upsertRecord(key, { id: "app", ...(value || {}) });
    }
    return setTable(key, Array.isArray(value) ? value : []);
  }

  async function setTable(key, records) {
    await ready();
    if (!Array.isArray(records)) throw new Error(`Firestore table must be an array: ${key}`);
    const collection = db.collection(collectionName(key));
    const existing = await collection.get();
    const nextIds = new Set(records.map((record) => String(record.id)));
    const operations = [];

    // Replace the collection from the application's point of view. Operations
    // are chunked below Firestore's batch limit so large hospital tables migrate.
    existing.docs.forEach((doc) => {
      if (!nextIds.has(doc.id)) operations.push({ type: "delete", ref: doc.ref });
    });
    records.forEach((record) => {
      if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
      const data = safeRecord(key, record);
      delete data.id;
      operations.push({ type: "set", ref: collection.doc(String(record.id)), data });
    });
    await commitOperations(operations);
    return records;
  }

  async function upsertRecord(key, record) {
    await ready();
    if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
    const data = safeRecord(key, record);
    delete data.id;
    await db.collection(collectionName(key)).doc(String(record.id)).set(data, { merge: false });
    return record;
  }

  async function upsertRecords(key, records) {
    await ready();
    if (!Array.isArray(records) || !records.length) return;
    const operations = records.map((record) => {
      if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
      const data = safeRecord(key, record);
      delete data.id;
      return { type: "set", ref: db.collection(collectionName(key)).doc(String(record.id)), data };
    });
    await commitOperations(operations);
  }

  async function deleteRecords(key, ids) {
    await ready();
    const batch = db.batch();
    ids.forEach((id) => batch.delete(db.collection(collectionName(key)).doc(String(id))));
    await batch.commit();
  }

  function subscribe(key, onChange, onError) {
    init();
    return db.collection(collectionName(key)).onSnapshot(
      (snap) => onChange(snap.docChanges().map((change) => ({
        type: change.type,
        record: Object.assign({ id: change.doc.id }, change.doc.data())
      }))),
      (error) => onError && onError(error)
    );
  }

  window.MitaliFirebase = Object.freeze({
    config: Object.freeze({ projectId: firebaseConfig.projectId }),
    collections: Object.freeze(Object.assign({}, COLLECTIONS)),
    init,
    ready,
    getTable,
    setTable,
    getValue,
    getReadMetrics,
    resetReadMetrics,
    setValue,
    upsertRecord,
    upsertRecords,
    deleteRecords,
    subscribe,
    authEmailForUsername,
    signInWithUsername,
    createAuthUserForUsername,
    changePassword,
    adminAccountRequest,
    adminCreateAccount,
    configureManagerRecovery,
    recoverManagerPassword,
    adminUpdateAccount,
    adminListAccounts,
    adminDeleteAccount,
    adminWipeBusinessData,
    signOut,
    authUser,
    waitForAuth,
    getUserProfile,
    setUserProfile,
    updateOwnSecurityMetadata,
    deleteUserProfile
  });
})();
