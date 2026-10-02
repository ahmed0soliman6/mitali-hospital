const fs = require('fs');
const assert = require('assert');

const index = fs.readFileSync('index.html', 'utf8');

// 1) زر تسجيل الزيارة في العيادات والأسنان يُعطَّل ويقفل عند الحفظ في القالب
assert.match(index, /<button type="submit" class="btn"\$\{ACTIVE_UI_SAVES\.has\(isDental \? "visitsDental" : "visitsClinic"\) \? ' disabled style="opacity:0\.65; pointer-events:none;"' : ""\}>/);
assert.match(index, /ACTIVE_UI_SAVES\.has\(isDental \? "visitsDental" : "visitsClinic"\) \? "⏳ جارٍ تسجيل الزيارة\.\.\." : \(editing \? "حفظ التعديل" : "تسجيل الزيارة"\)/);

// 2) عند الضغط، يُعطَّل الزر لحظيًا بشكل متزامن ويُمنع أي نقر مزدوج
const visitSubmitHandler = index.slice(index.indexOf('if (visitForm) visitForm.addEventListener("submit"'));
const visitFn = visitSubmitHandler.slice(0, visitSubmitHandler.indexOf('async function runVisitSave()'));
assert.match(visitFn, /const submitBtn = visitForm\.querySelector\('button\[type="submit"\]'\);/);
assert.match(visitFn, /submitBtn\.disabled = true;/);
assert.match(visitFn, /submitBtn\.style\.pointerEvents = "none";/);
assert.match(visitFn, /submitBtn\.textContent = editing \? "⏳ جارٍ حفظ التعديل\.\.\." : "⏳ جارٍ تسجيل الزيارة\.\.\.";/);

// 3) عند حدوث خطأ، يُعاد تمكين الزر واستعادة النص
assert.match(visitFn, /formLocked = false;/);
assert.match(visitFn, /submitBtn\.disabled = false;/);

// 4) مسح القفل قبل إعادة الرسم النهائية
const runVisitSaveBody = visitSubmitHandler.slice(0, visitSubmitHandler.indexOf('const cancelBtn = document.getElementById("cancelEdit");'));
assert.match(runVisitSaveBody, /ACTIVE_UI_SAVES\.delete\(saveKey\);\s*route\(\);/);

// 5) زر تسجيل العمليات والتحاليل والأشعة يُعطَّل ويقفل بالمثل
assert.match(index, /<button type="submit" class="btn"\$\{ACTIVE_UI_SAVES\.has\(cfg\.listKey\) \? ' disabled style="opacity:0\.65; pointer-events:none;"' : ""\}>/);
const svcSubmitHandler = index.slice(index.indexOf('if (svcForm) svcForm.addEventListener("submit"'));
const svcFk = svcSubmitHandler.slice(0, svcSubmitHandler.indexOf('async function runServiceSave()'));
assert.match(svcFk, /const submitBtn = svcForm\.querySelector\('button\[type="submit"\]'\);/);
assert.match(svcFk, /submitBtn\.disabled = true;/);
assert.match(svcFk, /submitBtn\.style\.pointerEvents = "none";/);

console.log('PASS visit-double-save-lock-test: visit and service form submit buttons lock and disable immediately upon click until the save transaction finishes, preventing duplicate entries.');
