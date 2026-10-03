const BASE_URL = 'https://tenthpowerserver1.netlify.app';

console.log(`\n======================================================`);
console.log(`🧪 TESTING LIVE NETLIFY API: ${BASE_URL}`);
console.log(`======================================================\n`);

async function testEndpoint(name, url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, options);
    const duration = Date.now() - start;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) { }

    if (res.ok) {
      console.log(`✅ [${res.status}] ${name} (${duration}ms)`);
      if (json && json.data) {
        if (Array.isArray(json.data)) {
          console.log(`   👉 Elements count: ${json.data.length} items`);
          if (json.data.length > 0) {
            console.log(`   👉 Sample item:`, JSON.stringify(json.data[0]).slice(0, 120) + '...');
          }
        } else {
          console.log(`   👉 Data payload:`, JSON.stringify(json.data).slice(0, 120) + '...');
        }
      } else {
        console.log(`   👉 Response:`, text.slice(0, 120));
      }
      return true;
    } else {
      console.error(`❌ [${res.status}] ${name} (${duration}ms)`);
      console.error(`   👉 Error Response:`, text);
      return false;
    }
  } catch (err) {
    console.error(`💥 [FAILED] ${name}:`, err.message);
    return false;
  }
}

async function runAllTests() {
  const results = [];

  // 1. Health
  results.push(await testEndpoint('1. Health Check', `${BASE_URL}/api/v1/health`));

  // 2. Company Info (companies table)
  results.push(await testEndpoint('2. Company Info', `${BASE_URL}/api/v1/company`));

  // 3. Services (services table)
  results.push(await testEndpoint('3. Services List', `${BASE_URL}/api/v1/services`));

  // 4. Projects (projects table)
  results.push(await testEndpoint('4. Projects List', `${BASE_URL}/api/v1/projects`));

  // 5. Gallery (media_library table)
  results.push(await testEndpoint('5. Gallery / Media', `${BASE_URL}/api/v1/gallery`));

  // 6. Advertisements (advertisements table)
  results.push(await testEndpoint('6. Advertisements', `${BASE_URL}/api/v1/ads`));

  // 7. Contact / Quote Request (messages, users, quote_requests tables)
  results.push(
    await testEndpoint('7. Send Quote Request (POST)', `${BASE_URL}/api/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'مهندس اختبار تجريبي',
        phone: '0539998877',
        service_type: 'واجهات استركشر وزجاج سيكوريت',
        message: 'طلب تسعير واجهات زجاجية لبرج تجاري مساحة 800 متر مربع',
      }),
    })
  );

  // 8. Push Notifications Token (push_subscriptions table)
  results.push(
    await testEndpoint('8. Push Subscription (POST)', `${BASE_URL}/api/v1/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'fcm_test_device_token_' + Date.now(),
        platform: 'android',
        device_info: { brand: 'Samsung', model: 'Galaxy S24' },
      }),
    })
  );

  console.log(`\n======================================================`);
  const passed = results.filter(Boolean).length;
  console.log(`🏁 RESULT: ${passed} / ${results.length} ENDPOINTS PASSED`);
  console.log(`======================================================\n`);
}

runAllTests();
