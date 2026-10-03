import { Hono } from 'hono';
import { executeNeon } from '../db/neon.js';

export const contactRouter = new Hono();

function escapeHtml(str: string) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function notifyTelegramAdmins(data: { name: string; phone: string; service_type?: string; message: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
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
`🔔 <b>طلب عرض سعر جديد من التطبيق</b> 🏗️
━━━━━━━━━━━━━━━━━━━
👤 <b>الاسم:</b> ${escapeHtml(data.name)}
📱 <b>الجوال:</b> <code>${escapeHtml(data.phone)}</code>
🏢 <b>الخدمة:</b> ${escapeHtml(data.service_type || 'طلب عام')}
📝 <b>تفاصيل الطلب:</b>
${escapeHtml(data.message)}
━━━━━━━━━━━━━━━━━━━
🕒 <b>الوقت:</b> ${time}
📱 <b>المصدر:</b> تطبيق الجوال (Tenth Power App)`;

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

contactRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { name, phone, message, service_type } = body;

    if (!name || !phone || !message) {
      return c.json(
        { success: false, error: 'Name, phone, and message are required' },
        400
      );
    }

    const subject = service_type
      ? `طلب خدمة: ${service_type} - من: ${name}`
      : `استفسار من تطبيق الجوال - من: ${name}`;

    const content = `الاسم: ${name}\nالجوال: ${phone}\nالخدمة: ${service_type || 'عام'}\nالرسالة: ${message}`;

    // 1. Insert into messages table
    const msgSuccess = await executeNeon(
      `INSERT INTO messages (subject, content, type, is_read, created_at)
       VALUES ($1, $2, 'contact', false, NOW())`,
      [subject, content]
    );

    if (!msgSuccess) {
      return c.json({ success: false, error: 'Failed to record message' }, 500);
    }

    // 2. Register / Update user lead
    executeNeon(
      `INSERT INTO users (full_name, phone, source, created_at)
       VALUES ($1, $2, 'mobile_app', NOW())
       ON CONFLICT DO NOTHING`,
      [name, phone]
    );

    // 3. Insert into quote_requests with company_id & UUID
    if (service_type) {
      executeNeon(
        `INSERT INTO quote_requests (id, company_id, description, status, created_at)
         VALUES (gen_random_uuid(), (SELECT id FROM companies WHERE slug = 'tenth-power' OR slug ILIKE '%tenth%' LIMIT 1), $1, 'pending', NOW())`,
        [content]
      );
    }

    // 4. Send Telegram notification
    let tgDelivery = [];
    try {
      tgDelivery = await notifyTelegramAdmins({ name, phone, message, service_type });
    } catch (tgErr: any) {
      console.error('Telegram notification error:', tgErr.message);
      tgDelivery = [{ ok: false, error: tgErr.message }];
    }

    return c.json({
      success: true,
      message: 'تم إرسال طلبك بنجاح وسيتواصل معك مهندسونا فوراً.',
      telegram_delivery: tgDelivery,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
