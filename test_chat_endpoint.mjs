import http from 'node:http';

async function testEndpoint() {
  console.log('Testing Tenth Power AI Chat REST Endpoint...\n');

  const BASE_URL = 'http://localhost:8787';

  // 1. اختبار السؤال العام
  console.log('--- TEST 1: Sending Engineering Question ---');
  try {
    const payload1 = {
      messages: [
        { role: 'user', content: 'السلام عليكم، كم سعر متر الواجهات الزجاجية الاستركشر وزجاج السيكوريت؟' }
      ],
      locale: 'ar',
      stream: false
    };

    const res1 = await fetch(`${BASE_URL}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload1),
    });

    const json1 = await res1.json();
    console.log('Status Code:', res1.status);
    console.log('Response Success:', json1.success);
    console.log('AI Response Text:', json1.data?.text?.slice(0, 100) + '...');
    console.log('Session ID:', json1.data?.session_id);
    console.log('Interaction ID:', json1.data?.interaction_id);
    console.log('Suggested Actions:', json1.data?.suggested_actions);
    console.log('Lead Captured:', json1.data?.lead_captured);

    const sessionId = json1.data?.session_id;

    // 2. اختبار إرسال رقم الجوال والاسم (Lead Capture)
    console.log('\n--- TEST 2: Sending Contact Info (Lead Capture) ---');
    const payload2 = {
      messages: [
        { role: 'user', content: 'اسمي المهندس وهيب ورقم جوالي 0532438253، أحتاج تسعير واجهات لبرج في الرياض' }
      ],
      locale: 'ar',
      session_id: sessionId,
      stream: false
    };

    const res2 = await fetch(`${BASE_URL}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload2),
    });

    const json2 = await res2.json();
    console.log('Status Code:', res2.status);
    console.log('Lead Captured:', json2.data?.lead_captured);
    console.log('Lead Info:', json2.data?.lead_info);
    console.log('AI Response:', json2.data?.text?.slice(0, 120) + '...');

    // 3. اختبار استرجاع سجل الجلسة (History)
    if (sessionId) {
      console.log('\n--- TEST 3: Fetching Chat History ---');
      const res3 = await fetch(`${BASE_URL}/api/v1/chat/history?session_id=${sessionId}`);
      const json3 = await res3.json();
      console.log('History Status Code:', res3.status);
      console.log('Messages in Session count:', json3.data?.messages?.length);
      console.log('Messages:', json3.data?.messages?.map(m => `[${m.role}] ${m.content.slice(0, 40)}...`));
    }

    console.log('\n✅ ALL AI CHAT REST TESTS COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

testEndpoint();
