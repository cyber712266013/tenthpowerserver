# 🤖 دليل تكامل شات الذكاء الاصطناعي لتطبيقات أندرويد والجوال
### Tenth Power AI Chat Integration Guide for Android / Flutter

هذا الدليل مخصص لمطوري تطبيقات الأندرويد والجوال للربط المباشر مع نقطة نهاية شات الذكاء الاصطناعي (`/api/v1/chat`).

---

## 🧭 1. نقاط النهاية (Endpoints Overview)

| Method | Endpoint | الغرض |
| :--- | :--- | :--- |
| **POST** | `/api/v1/chat` | إرسال رسالة المستخدم والحصول على رد الذكاء الاصطناعي والتقاط العميل |
| **GET** | `/api/v1/chat/history?session_id={id}` | استرجاع سجل الرسائل لجلسة معينة عند إعادة فتح التطبيق |

- **عنوان الخادم الأساسي (Base URL):**
  - محلياً للتطوير: `http://10.0.2.2:8787` (لمحاكي أندرويد الافتراضي) أو `http://localhost:8787`
  - السحابي المباشر: `https://tenthpowerserver.netlify.app`

---

## 📡 2. مسار إرسال الرسالة (`POST /api/v1/chat`)

### أ) ترويسات الطلب (Headers)
```http
Content-Type: application/json
Accept: application/json
```

### ب) جسم الطلب (Request Body)
```json
{
  "messages": [
    { "role": "user", "content": "السلام عليكم، كم سعر متر زجاج السيكوريت 10 ملم؟" }
  ],
  "locale": "ar",
  "previous_interaction_id": null,
  "session_id": null,
  "stream": false
}
```

#### المعلمات (Parameters):
- `messages` (إلزامي): مصفوفة الرسائل الأخيرة. كل عنصر يحتوي على `role` (`user` أو `assistant`) و `content` (نص الرسالة).
- `locale` (اختياري، الافتراضي `"ar"`): لغة الردود (`"ar"` أو `"en"`).
- `previous_interaction_id` (اختياري): المعرف المستلم في الرد السابق للحفاظ على ذاكرة السياق المتعدد (Multi-turn Stateful interaction).
- `session_id` (اختياري): معرف الجلسة المستلم من أول رد لربط كافة رسائل المحادثة في قاعدة البيانات.
- `stream` (اختياري، الافتراضي `false`): إذا كانت `true` سيتم إرسال الرد بالبث المباشر كلمة بكلمة. لتطبيقات الموبايل يُنصح بـ `false` للحصول على كائن JSON متكامل وسهل المعالجة.

---

### ج) استجابة الـ JSON القياسية (Response Body)
```json
{
  "success": true,
  "data": {
    "text": "وعليكم السلام ورحمة الله وبركاته! أهلاً بك في مؤسسة القوة العاشرة للمقاولات العامة.\n\nتعتمد تكلفة متر زجاج السيكوريت 10 ملم على طبيعة الاستخدام (أبواب، قواطع مكتبية، كبائن شاور، أو واجهات خارجية)، ونوع الإكسسوارات وقطاعات الألمنيوم المرفقة.\n\nيمكنك [طلب عرض سعر ومقايسة مجانية](/contact) ليتواصل معك مهندسنا المختص.",
    "role": "assistant",
    "session_id": "c7a8b9d0-1234-5678-9abc-def012345678",
    "interaction_id": "int-987654321",
    "lead_captured": false,
    "lead_info": null,
    "suggested_actions": [
      {
        "title": "📝 طلب مقايسة وعرض سعر",
        "screen": "/contact",
        "action": "quote"
      },
      {
        "title": "🏗️ تصفح معرض المشاريع",
        "screen": "/projects",
        "action": "projects"
      },
      {
        "title": "✨ خدمات الزجاج والألمنيوم",
        "screen": "/services",
        "action": "services"
      }
    ]
  }
}
```

---

## 🎯 3. التقاط بيانات التواصل الذكي (Automatic Lead Capture)

عندما يكتب العميل رقم جواله في الشات (مثال: `"اسمي م. أحمد وهذا جوالي 0551234567 لطلب مقايسة واجهات"`):
1. السيرفر يقوم **فوراً وبشكل تلقائي** بما يلي:
   - استخراج الاسم ورقم الجوال.
   - حفظ بياناته في جدول `users` وجدول `messages` وجدول `quote_requests` في قاعدة بيانات Neon.
   - إرسال تنبيه Telegram فوري للمدراء عبر البوت بهاتفه ونصه.
2. يتضمن كائن الرد:
   ```json
   "lead_captured": true,
   "lead_info": {
     "name": "م. أحمد",
     "phone": "0551234567"
   }
   ```
3. يمكنك في واجهة الأندرويد إظهار رسالة تأكيد أو شارة خضراء تفيد بأنه: `"تم إرسال بياناتك للمهندس المختص وسيتصل بك قريباً"`.

---

## 🧭 4. جدول إجراءات التنقل السريع (Suggested Actions & Deep Links)

يقوم السيرفر بتوليد `suggested_actions` مقترحة ديناميكياً مع كل رد لتوجيه العميل داخل التطبيق عبر أزرار سريعة (Action Chips):

| مسار `screen` | الإجراء | الوظيفة في تطبيق الأندرويد |
| :--- | :--- | :--- |
| `/contact` | `quote` / `contact` | الانتقال لشاشة نموذج طلب عرض السعر والتواصل |
| `/projects` | `projects` | فتح شاشة استعراض المشاريع والواجهات |
| `/services` | `services` | فتح شاشة قائمة خدمات الزجاج والألمنيوم |
| `/gallery` | `gallery` | فتح معرض الصور والأعمال |

---

## 📱 5. أمثلة كود التكامل البرمجي

### أ) باستخدام Flutter / Dart:
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class AiChatService {
  final String baseUrl = 'https://tenthpowerserver.netlify.app/api/v1';
  String? sessionId;
  String? previousInteractionId;

  Future<Map<String, dynamic>?> sendMessage(String messageText, List<Map<String, String>> previousMessages) async {
    final url = Uri.parse('$baseUrl/chat');

    final body = {
      'messages': [
        ...previousMessages,
        {'role': 'user', 'content': messageText},
      ],
      'locale': 'ar',
      'session_id': sessionId,
      'previous_interaction_id': previousInteractionId,
      'stream': false,
    };

    final res = await http.post(
      url,
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: jsonEncode(body),
    );

    if (res.statusCode == 200) {
      final json = jsonDecode(utf8.decode(res.bodyBytes));
      if (json['success'] == true) {
        final data = json['data'];
        sessionId = data['session_id'];
        previousInteractionId = data['interaction_id'];
        return data; // يحتوي على text, suggested_actions, lead_captured
      }
    }
    return null;
  }
}
```

---

### ب) باستخدام Android / Kotlin (Retrofit):
```kotlin
data class ChatMessage(
    val role: String,
    val content: String
)

data class ChatRequest(
    val messages: List<ChatMessage>,
    val locale: String = "ar",
    val session_id: String? = null,
    val previous_interaction_id: String? = null,
    val stream: Boolean = false
)

data class SuggestedAction(
    val title: String,
    val screen: String,
    val action: String
)

data class ChatData(
    val text: String,
    val role: String,
    val session_id: String?,
    val interaction_id: String?,
    val lead_captured: Boolean,
    val suggested_actions: List<SuggestedAction>
)

data class ChatResponse(
    val success: Boolean,
    val data: ChatData
)

interface TenthPowerApiService {
    @POST("api/v1/chat")
    suspend fun sendChatMessage(@Body request: ChatRequest): Response<ChatResponse>

    @GET("api/v1/chat/history")
    suspend fun getChatHistory(@Query("session_id") sessionId: String): Response<Any>
}
```

---

## 🛡️ 6. الأمان والاعتمادية (Reliability & Fallback)

1. **تدوير المفاتيح الآلي (Multi-key Rotation):** في حال حدوث ضغط على مفتاح Gemini، يقوم السيرفر بالانتقال للمفتاح الاحتياطي فوراً وبشكل صامت دون إشعار المستخدم بأي خلل.
2. **الردود الذكية في وضع عدم الاتصال (Smart Offline Fallback):** حتى في حال تعطل خدمات الذكاء الاصطناعي العالمية، يقدم السيرفر إجابات فنية دقيقة ومتناسقة بناءً على الكلمات المفتاحية لمشاريع وأسعار القوة العاشرة.
