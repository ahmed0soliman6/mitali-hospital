const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');
const formStart = source.indexOf('<form id="moneyForm"');
const formEnd = source.indexOf('</form>', formStart);
assert.ok(formStart >= 0 && formEnd > formStart, 'money form should exist');
const form = source.slice(formStart, formEnd);
const positions = [
  ['date', form.indexOf('name="date"')],
  ['amount', form.indexOf('name="amount"')],
  ['doctor', form.indexOf('name="doctorId"')],
  ['party', form.indexOf('name="party"')],
  ['category', form.indexOf('name="category"')],
  ['desc', form.indexOf('name="desc"')],
  ['paymentMethod', form.indexOf('name="paymentMethod"')],
  ['person', form.indexOf('name="person"')],
  ['notes', form.indexOf('name="notes"')],
];
for (const [name, position] of positions) assert.ok(position >= 0, `${name} field should exist`);
for (let i = 1; i < positions.length; i += 1) {
  assert.ok(positions[i - 1][1] < positions[i][1], `${positions[i - 1][0]} must precede ${positions[i][0]}`);
}
assert.match(source, /amount - \(Number\(incomeDocShareInput\.value\) \|\| 0\)/, 'doctor share should calculate clinic remainder');
assert.match(source, /amount - \(Number\(incomeClinicShareInput\.value\) \|\| 0\)/, 'clinic share should calculate doctor remainder');
assert.match(source, /income-share-fields/, 'share inputs should use responsive layout');
assert.doesNotMatch(source, /id="generateDemo"|id="resetDemo"/, 'legacy demo-data controls must be removed');

console.log('PASS income-form-test: field order, responsive share fields, bidirectional share calculation, and demo-card removal contract.');
