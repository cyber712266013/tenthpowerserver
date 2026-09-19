// ─── GEMINI AI MULTI-KEY & STATEFUL ENGINE ─────────────────────────────────
import { getGeminiApiKeys, markKeyExhausted, markKeyHealthy } from './keys.mjs';
import { getCachedSystemPrompt } from './prompts.mjs';

function extractInteractionsText(data) {
  if (!data) return '';
  if (Array.isArray(data.steps)) {
    let combined = '';
    for (const step of data.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item.text) combined += item.text;
        }
      }
    }
    if (combined.trim()) return combined.trim();
  }
  if (Array.isArray(data.outputs) && data.outputs[0]?.text) return data.outputs[0].text.trim();
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text.trim();
  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  return '';
}

function extractGenerateContentText(data) {
  if (!data) return '';
  const candidate = data.candidates?.[0];
  if (candidate?.content?.parts) {
    return candidate.content.parts.map((p) => p.text || '').join('').trim();
  }
  return '';
}

export function getSuggestedActions(text = '', locale = 'ar') {
  const isAr = locale === 'ar';
  const lower = String(text).toLowerCase();

  const actions = [];

  if (/سعر|تكلفة|عرض|كم|احسب|price|cost|quote/.test(lower)) {
    actions.push({
      title: isAr ? '📝 طلب مقايسة وعرض سعر' : '📝 Request a Quote',
      screen: '/contact',
      action: 'quote',
    });
  }

  if (/مشروع|سابقة|أعمال|صور|برج|واجهات|project|work/.test(lower)) {
    actions.push({
      title: isAr ? '🏗️ تصفح معرض المشاريع' : '🏗️ View Executed Projects',
      screen: '/projects',
      action: 'projects',
    });
  }

  actions.push({
    title: isAr ? '✨ خدمات الزجاج والألمنيوم' : '✨ Our Services',
    screen: '/services',
    action: 'services',
  });

  if (actions.length < 3) {
    actions.push({
      title: isAr ? '📞 تواصل مع مهندسينا' : '📞 Contact an Engineer',
      screen: '/contact',
      action: 'contact',
    });
  }

  return actions;
}

export function getSmartFallbackResponse({
  input = '',
  leadCaptured = false,
  leadPhone = '',
  locale = 'ar',
  companyName = 'مؤسسة القوة العاشرة للمقاولات العامة',
}) {
  const isAr = locale === 'ar';
  const lower = input.toLowerCase();

  if (leadCaptured) {
    return isAr
      ? `شكراً لك أخي الكريم! تم استلام بياناتك بنجاح (${leadPhone}) وإرسال إشعار فوري للفريق الهندسي، وسيقوم مهندسنا المختص بالاتصال بك في أقرب وقت ممكن لمناقشة تفاصيل مشروعك.`
      : `Thank you! Your contact details (${leadPhone}) have been received and forwarded to our engineering team. An engineer will contact you shortly.`;
  }

  if (/سعر|تكلفة|كم|فلوس|متر|price|cost|estimate/.test(lower)) {
    return isAr
      ? `تعتمد تكلفة المتر المربع في أعمال الزجاج والألمنيوم على مواصفات المشروع الفنية (مثل سماكة ونوع الزجاج السيكوريت أو الدبل جلاس، ونوع قطاعات الألمنيوم المعزولة، وارتفاع الواجهات).\n\nيمكنك [طلب عرض سعر ومقايسة مجانية](/contact) ليقوم مهندسونا بإعداد دراسة فنية ومالية دقيقة لمشروعكم.`
      : `Estimates depend on technical specifications (such as tempered glass thickness, insulated double glazing, and aluminum profile types).\n\nYou can [Request a Free Quote](/contact) for a detailed technical and financial proposal.`;
  }

  if (/زجاج|سيكوريت|واجهة|استركشر|كرتن|كلادينج|glass|facade|curtain/.test(lower)) {
    return isAr
      ? `تختص ${companyName} بتصميم وتركيب أرقى أنظمة [الواجهات الزجاجية الهيكلية والكرتن وول](/services) وزجاج السيكوريت المقاوم للصدمات، مع ضمان عزل مائي وحراري فائق وفق كود البناء السعودي مع ضمان معتمد يصل حتى 10 سنوات.\n\nيمكنكم استعراض صور المشاريع عبر [معرض المشاريع](/projects).`
      : `${companyName} specializes in structural curtain walls, tempered securit glass facades, and architectural cladding conforming to SBC standards with warranties up to 10 years.\n\nExplore our recent works in the [Projects Portfolio](/projects).`;
  }

  if (/تواصل|اتصل|جوال|رقم|هاتف|phone|call|contact/.test(lower)) {
    return isAr
      ? `يسعدنا جداً التواصل معكم! تفضل بتزويدي بـ **اسمك الكريم ورقم جوالك** هنا في المحادثة، وسيتم إرسال إشعار فوري لمهندسينا للاتصال بك. أو يمكنك مراسلتنا مباشرة عبر [شاشة تواصل معنا](/contact).`
      : `We are glad to connect with you! Please provide your **name and phone number** here, and our engineers will reach out right away. You can also visit [Contact Us](/contact).`;
  }

  return isAr
    ? `أهلاً بك في ${companyName} 🏗️\n\nأنا مساعدك الهندسي الذكي، يسعدني تقديم المشورة الفنية حول أعمال واجهات الزجاج، السيكوريت، الألمنيوم، والكلادينج، والإجابة عن كافة استفساراتكم حول [المشاريع المنفذة](/projects) و[الخدمات المتاحة](/services). كيف يمكنني خدمتك اليوم؟`
    : `Welcome to ${companyName} 🏗️\n\nI am your AI Engineering Assistant, here to provide technical advice on glass facades, securit, aluminum, and cladding. How can I assist you with your project today?`;
}

export async function chatWithGemini({
  input,
  messages = [],
  previousInteractionId = null,
  locale = 'ar',
  systemPromptOverride,
  queryNeon,
}) {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    console.warn('[Gemini Engine] No Gemini API keys configured in environment.');
    return null;
  }

  const promptConfig = await getCachedSystemPrompt(queryNeon, locale);
  const systemInstruction = systemPromptOverride || promptConfig.prompt;
  const model = process.env.GEMINI_MODEL || promptConfig.model || 'gemini-2.5-flash';

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    const keyPreview = `...${apiKey.slice(-6)}`;

    // 1. تجربة Stateful Interactions API
    try {
      const interactionPayload = { model, input };
      if (previousInteractionId) {
        interactionPayload.previous_interaction_id = previousInteractionId;
      } else {
        interactionPayload.system_instruction = systemInstruction;
      }

      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(interactionPayload),
      });

      if (res.status === 429 || res.status === 403) {
        markKeyExhausted(apiKey, `HTTP_${res.status}`);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        const text = extractInteractionsText(data);
        const newInteractionId = data.id || data.interaction_id || previousInteractionId;
        if (text) {
          markKeyHealthy(apiKey);
          return {
            text,
            interactionId: newInteractionId,
            model,
            keyUsed: keyPreview,
            source: 'interactions',
          };
        }
      }
    } catch (err) {
      console.warn(`[Gemini Engine] Interactions API error with key ${keyPreview}:`, err.message);
    }

    // 2. بديل: GenerateContent API
    try {
      const contents = [];
      if (Array.isArray(messages) && messages.length > 0) {
        for (const m of messages.slice(-8)) {
          contents.push({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || '' }],
          });
        }
      }
      if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: input }],
        });
      }

      const gcPayload = {
        system_instruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gcPayload),
        }
      );

      if (res.status === 429 || res.status === 403) {
        markKeyExhausted(apiKey, `HTTP_${res.status}`);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        const text = extractGenerateContentText(data);
        if (text) {
          markKeyHealthy(apiKey);
          return {
            text,
            interactionId: previousInteractionId || `gc-${Date.now()}`,
            model,
            keyUsed: keyPreview,
            source: 'generateContent',
          };
        }
      }
    } catch (gcErr) {
      console.warn(`[Gemini Engine] GenerateContent error with key ${keyPreview}:`, gcErr.message);
    }
  }

  return null;
}
