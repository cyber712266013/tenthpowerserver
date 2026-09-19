import { Hono } from 'hono';
import { queryNeon, executeNeon } from '../db/neon.js';
import {
  chatWithGemini,
  processChatLead,
  getSmartFallbackResponse,
  getSuggestedActions,
} from '../lib/ai/index.mjs';

export const chatRouter = new Hono();

function escapeHtml(str: string) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function notifyTelegramAdmins(data: { name: string; phone: string; service_type?: string; message: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '8955032327:AAF2Uehcl6-cRr3MfIckeoLuFrRjyqO9bdo';
  const defaultAdminIds = ['5887234832'];
  const envAdminIds = (process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => Boolean(s) && s !== '123456789');
  const adminIds = Array.from(new Set([...defaultAdminIds, ...envAdminIds]));

  if (!token || adminIds.length === 0) {
    return [{ ok: false, description: 'Missing token or admin IDs' }];
  }

  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  const text = 
`🔔 <b>طلب استشارة جديد من شات التطبيق</b> 🤖
━━━━━━━━━━━━━━━━━━━
👤 <b>الاسم:</b> ${escapeHtml(data.name)}
📱 <b>الجوال:</b> <code>${escapeHtml(data.phone)}</code>
🏢 <b>القسم:</b> ${escapeHtml(data.service_type || 'شات الذكاء الاصطناعي')}
📝 <b>محتوى الرسالة:</b>
${escapeHtml(data.message)}
━━━━━━━━━━━━━━━━━━━
🕒 <b>الوقت:</b> ${time}
📱 <b>المصدر:</b> شات تطبيق الجوال (Tenth Power Mobile App)`;

  const deliveryResults = [];
  for (const chatId of adminIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
        }),
      });
      const json = await res.json();
      deliveryResults.push({ chatId, ok: json.ok, description: json.description });
    } catch (err: any) {
      deliveryResults.push({ chatId, ok: false, error: err.message });
    }
  }
  return deliveryResults;
}

// POST /api/v1/chat
chatRouter.post('/', async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({}));
    const {
      messages = [],
      locale = 'ar',
      previous_interaction_id,
      interaction_id,
      session_id,
      stream = false,
    } = payload;

    const isAr = locale === 'ar';
    const lastUserMessage = messages?.[messages.length - 1]?.content ?? payload.message ?? '';
    const previousId = previous_interaction_id || interaction_id || null;
    const companySlug = process.env.COMPANY_SLUG || 'tenth-power';

    let companyId = '00d8d3a7-fa3b-4dd5-bf05-8081a6fc1089';
    try {
      const compRows = await queryNeon(
        `SELECT id FROM companies WHERE slug = $1 OR slug ILIKE '%tenth%' LIMIT 1`,
        [companySlug]
      );
      if (compRows && compRows.length > 0) {
        companyId = compRows[0].id;
      }
    } catch (_) {}

    let leadCaptured = false;
    let leadPhone = '';
    let leadName = '';

    // 1. Lead capture
    if (lastUserMessage) {
      try {
        const leadResult = await processChatLead({
          text: lastUserMessage,
          sessionId: session_id,
          locale,
          companyId,
          queryNeon,
          executeNeon,
          notifyTelegramAdmins,
        });

        if (leadResult && leadResult.captured && leadResult.phone) {
          leadCaptured = true;
          leadPhone = leadResult.phone;
          leadName = leadResult.name || '';
        }
      } catch (leadErr: any) {
        console.warn('[Hono Chat] Lead capture error:', leadErr.message);
      }
    }

    // 2. Gemini Multi-key Call
    let aiResponseText = '';
    let nextInteractionId = previousId;

    if (lastUserMessage) {
      try {
        const promptOverrideNote = leadCaptured
          ? isAr
            ? `العميل أرسل بياناته الآن (الاسم: ${leadName}، الجوال: ${leadPhone}). تم حفظ طلبه في النظام وإرسال إشعار فوري لمهندسينا. اشكر العميل بحرارة وأكد له أن المهندس المختص سيتواصل معه عبر الهاتف أو الواتساب في أقرب وقت لمناقشة مقايسة مشروعه.`
            : `Client just provided contact info (Name: ${leadName}, Phone: ${leadPhone}). Details were forwarded to our engineers. Thank the client warmly and confirm that an engineer will contact them promptly.`
          : undefined;

        const aiResult = await chatWithGemini({
          input: lastUserMessage,
          messages,
          previousInteractionId: previousId,
          locale,
          systemPromptOverride: promptOverrideNote,
          queryNeon,
        });

        if (aiResult?.text) {
          aiResponseText = aiResult.text;
          nextInteractionId = aiResult.interactionId || previousId;
        }
      } catch (geminiErr: any) {
        console.error('[Hono Chat] Gemini call error:', geminiErr.message);
      }
    }

    // 3. Fallback
    if (!aiResponseText) {
      aiResponseText = getSmartFallbackResponse({
        input: lastUserMessage,
        leadCaptured,
        leadPhone,
        locale,
      });
    }

    // 4. Persistence
    let currentSessionId = session_id;
    try {
      if (!currentSessionId) {
        const contextObj = {
          locale,
          last_interaction_id: nextInteractionId,
          lead_captured: leadCaptured,
          lead_phone: leadPhone || null,
          platform: 'android_app',
        };
        const sessRows = await queryNeon(
          `INSERT INTO chat_sessions (id, company_id, status, message_count, context, created_at)
           VALUES (gen_random_uuid(), $1, 'active', 2, $2, NOW())
           RETURNING id;`,
          [companyId, JSON.stringify(contextObj)]
        );
        if (sessRows && sessRows.length > 0) {
          currentSessionId = sessRows[0].id;
        }
      } else {
        const contextObj = {
          locale,
          last_interaction_id: nextInteractionId,
          lead_captured: leadCaptured,
          lead_phone: leadPhone || null,
          platform: 'android_app',
        };
        await executeNeon(
          `UPDATE chat_sessions
           SET message_count = COALESCE(message_count, 0) + 2,
               context = $1
           WHERE id::text = $2`,
          [JSON.stringify(contextObj), currentSessionId]
        );
      }

      if (currentSessionId && lastUserMessage) {
        const actions = getSuggestedActions(aiResponseText, locale);
        await executeNeon(
          `INSERT INTO chat_messages (id, session_id, role, content, created_at)
           VALUES (gen_random_uuid(), $1, 'user', $2, NOW())`,
          [currentSessionId, lastUserMessage]
        );
        await executeNeon(
          `INSERT INTO chat_messages (id, session_id, role, content, suggested_actions, created_at)
           VALUES (gen_random_uuid(), $1, 'assistant', $2, $3, NOW())`,
          [currentSessionId, aiResponseText, actions.map((a: any) => a.screen)]
        );
      }
    } catch (dbErr: any) {
      console.warn('[Hono Chat] Persistence warning:', dbErr.message);
    }

    const suggestedActions = getSuggestedActions(aiResponseText, locale);

    if (nextInteractionId) c.header('x-interaction-id', nextInteractionId);
    if (currentSessionId) c.header('x-session-id', currentSessionId);
    if (leadCaptured) c.header('x-lead-captured', 'true');

    return c.json({
      success: true,
      data: {
        text: aiResponseText,
        role: 'assistant',
        session_id: currentSessionId,
        interaction_id: nextInteractionId,
        lead_captured: leadCaptured,
        lead_info: leadCaptured ? { name: leadName, phone: leadPhone } : null,
        suggested_actions: suggestedActions,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/v1/chat/history
chatRouter.get('/history', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) {
    return c.json({ success: false, error: 'session_id is required' }, 400);
  }

  try {
    const rows = await queryNeon(
      `SELECT id, role, content, created_at FROM chat_messages WHERE session_id::text = $1 ORDER BY created_at ASC`,
      [sessionId]
    );

    return c.json({
      success: true,
      data: {
        session_id: sessionId,
        messages: rows.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        })),
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
