// inbox.js
// واجهة أمامية لتبديل حالة 'منصرف' في صفحة الوارد
// الاستخدام: تأكد من ربط هذا الملف في صفحة inbox ( <script src="/public/js/inbox.js"></script> )

document.addEventListener('click', (e) => {
  if (e.target.matches('.toggle-discharged')) {
    const row = e.target.closest('tr');
    if (!row) return;
    const cell = row.querySelector('.discharged-cell');
    if (!cell) return;
    const isDischarged = cell.textContent.trim() === 'نعم';

    // نبدل النص والكلاس محليًا
    cell.textContent = isDischarged ? 'لا' : 'نعم';
    row.classList.toggle('discharged', !isDischarged);

    // إذا أردت الحفظ في السيرفر: فك التعليق وأكمل المسار وواجهتك الخلفية
    /*
    const id = row.dataset.id;
    fetch(`/api/patients/${id}/discharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discharged: !isDischarged })
    })
    .then(r => r.json())
    .then(data => {
      // تحقق من نجاح الحفظ أو أعد الحالة عند الخطأ
      if (!data.ok) {
        cell.textContent = isDischarged ? 'نعم' : 'لا';
        row.classList.toggle('discharged', isDischarged);
        alert('حدث خطأ أثناء حفظ الحالة على الخادم');
      }
    })
    .catch(() => {
      cell.textContent = isDischarged ? 'نعم' : 'لا';
      row.classList.toggle('discharged', isDischarged);
      alert('خطأ في الاتصال');
    });
    */
  }
});
