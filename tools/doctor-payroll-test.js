const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

assert.match(source, /name="docFollowupPct"/, 'doctor form must expose follow-up doctor percentage');
assert.match(source, /name="clinicFollowupPct"/, 'doctor form must expose follow-up clinic percentage');
assert.match(source, /docFollowupPct: docFollowupPctVal \/ 100/, 'follow-up doctor percentage must be persisted as a fraction');
assert.match(source, /clinicFollowupPct: clinicFollowupPctVal \/ 100/, 'follow-up clinic percentage must be persisted as a fraction');
assert.match(source, /function percentShareForExam\(doctor, examType\)/, 'percentage selection must depend on exam type');
assert.match(source, /isFollowup \? \(doctor\.docFollowupPct \?\? doctor\.docPct\)/, 'follow-up percentage must fall back to legacy doctor percentage');
assert.match(source, /isFollowup \? \(doctor\.clinicFollowupPct \?\? doctor\.clinicPct\)/, 'follow-up clinic percentage must fall back to legacy clinic percentage');
assert.match(source, /const pct = percentShareForExam\(d, visit\.examType\)/, 'visit share must use the selected exam type percentage');
assert.match(source, /mode === "fixed_daily"/, 'settlement must handle fixed daily doctors separately');
assert.match(source, /Number\(d\.dailyFixedAmount\) \|\| 0\) \* activeDays\.size/, 'fixed daily doctor share must be daily amount times active days');
assert.match(source, /const activeDays = new Set\(/, 'active work days must be deduplicated');
assert.doesNotMatch(source, /docShare = netRevenue \* \(d\.docPct \|\| 0\)/, 'settlement must not use the old single-percentage formula');
assert.match(source, /مجموع نسب المتابعة/, 'follow-up percentage sum must be visible');

console.log('PASS doctor-payroll-test: fixed daily doctor shares, independent exam/follow-up percentages, legacy fallback, and settlement safeguards.');
