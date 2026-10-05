const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

assert.match(source, /<option value="تحاليل"/, 'doctor type dropdown must include laboratories');
assert.match(source, /<option value="أشعة"/, 'doctor type dropdown must include radiology');
assert.match(source, /const FORCED_PERCENT_DOCTOR_TYPES = new Set\(\["أسنان"\]\)/, 'only dental doctors remain forced percentage mode');
assert.match(source, /const feeMode = doctorTypeUsesPercent\(type\) \? "percent" : \(fd\.get\("feeMode"\) \|\| "fixed_visit"\)/, 'lab and radiology doctors must honor the selected fee mode');
assert.match(source, /<option value="fixed_visit"/, 'lab/radiology doctor form must offer fixed visit amount');
assert.match(source, /<option value="percent"/, 'lab/radiology doctor form must offer percentage mode');
assert.match(source, /<option value="fixed_daily"/, 'lab/radiology doctor form must offer fixed daily mode');
assert.match(source, /doctorTypeUsesPercent\(d\.type\) \? "percent"/, 'share calculations must recognize forced department types');
assert.match(source, /labs:.*doctorType: "تحاليل"/, 'lab diary must be mapped to lab doctors');
assert.match(source, /radiology:.*doctorType: "أشعة"/, 'radiology diary must be mapped to radiology doctors');
assert.match(source, /const serviceDoctors = cfg\.doctorType \? sortedDoctors\(\)\.filter\(d => d\.type === cfg\.doctorType/, 'service diaries must filter doctors by department');
assert.match(source, /name="doctorId" required/, 'lab and radiology forms must require a department doctor');
assert.match(source, /doctorId: cfg\.doctorType \? \(fd\.get\("doctorId"\) \|\| null\)/, 'service records must persist the selected doctor');
assert.match(source, /computeShare\(v\)\.doc/, 'service diary must display the doctor share');
assert.match(source, /function allRevenueVisits\(\)/, 'doctor revenue and settlements must have a cross-department visit source');
assert.match(source, /const visits = allRevenueVisits\(\)\.filter\(v => v\.doctorId === doctorId\)/, 'doctor dashboard revenue must include lab/radiology visits');
assert.match(source, /const allMonthVisits = exactPlan \? exactMonthVisits\(ym\) : allRevenueVisits\(\)\.filter/, 'monthly doctor settlement must include lab/radiology visits');
assert.match(source, /function exactMonthVisits\(ym\) \{\s*return VISIT_SOURCE_DEFINITIONS\.flatMap/, 'exact monthly settlement visits must cover all five departments');
assert.match(source, /allRevenueVisits\(\)\.some\(v => v\.doctorId === docId\)/, 'doctor deletion history must include lab/radiology visits');

console.log('PASS doctor-departments-test: lab/radiology doctor types, selectable fee modes, diary assignment, shares, and cross-department settlements.');
