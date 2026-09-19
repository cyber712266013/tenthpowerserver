// ─── AI LEAD CAPTURE & TELEGRAM NOTIFIER FOR MOBILE APP ───────────────────
import crypto from 'node:crypto';

export function normalizeArabicDigits(str) {
  if (!str) return '';
  const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).replace(/[٠-٩]/g, (w) => arabicNumbers.indexOf(w).toString());
}

export function extractPhoneNumber(text) {
  if (!text) return null;
  const normalized = normalizeArabicDigits(text).replace(/[\u200e\u200f\s-]/g, '');
  const saudiMatch = normalized.match(/(?:\+?966|0)?5[0-9]{8}/);
  if (saudiMatch) {
    let clean = saudiMatch[0];
    if (clean.startsWith('+966')) clean = '0' + clean.slice(4);
    else if (clean.startsWith('966')) clean = '0' + clean.slice(3);
    return clean;
  }
  const generalMatch = normalized.match(/(?:\+|00)?[0-9]{9,14}/);
  return generalMatch ? generalMatch[0] : null;
}

export function extractName(text) {
  if (!text) return 'عميل مهتم (عبر شات التطبيق)';
  const patterns = [
    /(?:اسمي|أنا|معكم|الاسم\s*:?)\s+([^\d\n،,.]+)/i,
    /(?:أخوكم|الأخ|المهندس|المهندسة|م\.)\s+([^\d\n،,.]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]?.trim().length >= 2) {
      let raw = m[1].trim();
      // إزالة الكلمات اللاحقة مثل "ورقم" أو "وجوالي" أو "وهذا"
      raw = raw.replace(/\s+(?:ورقم|وجوالي|ورقمي|وهذا|جوالي|رقمي|أحتاج|أريد|وهذا رقمي).*$/i, '');
      if (raw.length >= 2) return raw.slice(0, 40);
    }
  }
  return 'عميل مهتم (عبر شات التطبيق)';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function processChatLead({
  text,
  sessionId,
  locale = 'ar',
  companyId = '00d8d3a7-fa3b-4dd5-bf05-8081a6fc1089',
  queryNeon,
  executeNeon,
  notifyTelegramAdmins,
}) {
  const phone = extractPhoneNumber(text);
  if (!phone) return { captured: false };

  const name = extractName(text);

  try {
    // 1. فحص منع التكرار في نفس الجلسة
    if (sessionId && typeof queryNeon === 'function') {
      try {
        const rows = await queryNeon(
          `SELECT context FROM chat_sessions WHERE id::text = $1 LIMIT 1`,
          [sessionId]
        );
        if (rows && rows.length > 0) {
          const ctx = rows[0].context || {};
          if (ctx.lead_phone === phone) {
            return { captured: true, phone, name };
          }
        }
      } catch (_) {}
    }

    let userId = null;

    // 2. تسجيل/تحديث المستخدم في جدول users
    if (typeof queryNeon === 'function') {
      try {
        const metadata = JSON.stringify({ locale, session_id: sessionId, source: 'ai_chat_mobile' });
        const userRows = await queryNeon(
          `INSERT INTO users (company_id, full_name, phone, source, metadata, created_at)
           VALUES ($1, $2, $3, 'ai_chat_mobile', $4, NOW())
           ON CONFLICT (company_id, phone) DO UPDATE SET 
             full_name = EXCLUDED.full_name,
             metadata = EXCLUDED.metadata
           RETURNING id;`,
          [companyId, name, phone, metadata]
        );
        if (userRows && userRows.length > 0) {
          userId = userRows[0].id;
        }
      } catch (err) {
        console.warn('[AI Lead Capture] Warning upserting user:', err.message);
      }
    }

    // 3. حفظ الرسالة في جدول messages
    const messageContent = `طلب اتصال واستشارة هندسية من شات تطبيق الجوال.\n\nبيانات العميل:\n- الاسم: ${name}\n- الجوال: ${phone}\n\nنص رسالة العميل:\n${text}`;
    if (typeof executeNeon === 'function') {
      try {
        await executeNeon(
          `INSERT INTO messages (company_id, user_id, subject, content, type, is_read, created_at)
           VALUES ($1, $2, '🤖 طلب تواصل واستشارة عبر شات تطبيق الجوال', $3, 'contact', false, NOW())`,
          [companyId, userId, messageContent]
        );

        // إنشاء طلب عرض سعر إذا تضمنت الرسالة كلمات تسعير
        const isQuote = /سعر|تكلفة|عرض|مقايسة|مشروع|واجهة|زجاج|ألمنيوم/i.test(text);
        if (isQuote) {
          await executeNeon(
            `INSERT INTO quote_requests (id, company_id, description, status, created_at)
             VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())`,
            [companyId, `طلب من شات الجوال (${name} - ${phone}):\n${text}`]
          );
        }
      } catch (err) {
        console.warn('[AI Lead Capture] Warning saving message:', err.message);
      }
    }

    // 4. إرسال إشعار فوري لمدراء النظام عبر بوت تيليجرام
    if (typeof notifyTelegramAdmins === 'function') {
      const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
      const customNotification = {
        name,
        phone,
        service_type: 'استشارة فورية من شات التطبيق الذكي 🤖',
        message: `العميل يتحدث الآن مع المساعد الذكي في التطبيق:\n"${text}"\n\nيرجى المتابعة والاتصال به فوراً.`,
      };
      await notifyTelegramAdmins(customNotification);
    }

    return { captured: true, phone, name };
  } catch (err) {
    console.error('[AI Lead Capture] Fatal error:', err.message);
    return { captured: false };
  }
}
