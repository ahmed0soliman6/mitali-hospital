const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
assert.match(index, /\{ id: "users", label: "المستخدمون والصلاحيات"/);
assert.doesNotMatch(index, /\{ id: "permissions", label:/);
assert.match(index, /if \(page === "permissions"\) return "users"/);
assert.match(index, /users: "المستخدمون والصلاحيات", permissions: "المستخدمون والصلاحيات"/);
assert.doesNotMatch(index, /staffForm/);
assert.doesNotMatch(index, /data-delstaff/);
assert.doesNotMatch(index, /🔐 حسابات تسجيل الدخول للموظفين/);
assert.match(index, /usersPermissionsPanel/);
assert.match(index, /function renderPermissionsPage\(\) \{ renderUsersPage\(\); \}/);
assert.match(index, /adminUpdateAccount\(\{ uid: selected\.firebaseUid[\s\S]*?\}, "permissions"\)/);
assert.match(index, /اسم المستخدم: \$\{esc\(a\.username \|\| "غير مسجل"\)\}/);
console.log('PASS unified-users-page-test: one users/permissions page, no legacy settings account card, and explicit username/permission contract.');
