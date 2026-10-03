const BASE_URL = 'https://tenthpowerserver1.netlify.app';

async function testQuoteToTelegram() {
  console.log('Sending live test quote request to Netlify API...');
  const res = await fetch(`${BASE_URL}/api/v1/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'وهيب (تجربة فورية)',
      phone: '0532438253',
      service_type: 'واجهات زجاج سيكوريت واستركشر',
      message: 'هذه رسالة اختبار للتأكد من وصول إشعار طلب عرض السعر إلى بوت التلجرام فوراً 🚀',
    }),
  });

  const data = await res.json();
  console.log('API Response:', data);
}

testQuoteToTelegram();
