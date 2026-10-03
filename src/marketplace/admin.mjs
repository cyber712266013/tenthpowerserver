/**
 * src/marketplace/admin.mjs
 * مسارات وإجراءات لوحة تحكم القوة العاشرة (الموافقة والرفض، الإحصائيات، الإشراف، إدارة الأقسام والمستخدمين)
 */
import { sendFcmPush } from './fcm.mjs';

export async function handleAdminRoutes({
  pathname,
  method,
  url,
  body,
  req,
  json,
  queryNeon,
  config,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'admin', resource, id, action]
  const [, , feature, resource, id, action] = segments;

  if (feature !== 'admin') return false;

  // ── التحقق من صلاحيات الأدمن ──────────────────────────────────────────────
  const adminKey = req.headers['x-admin-key'] || req.headers['admin-secret-key'];
  const isAdminKey = config.ADMIN_SECRET_KEY && adminKey === config.ADMIN_SECRET_KEY;
  const isAdminJwt = authUser && (authUser.role === 'admin' || authUser.role === 'moderator');

  if (!isAdminKey && !isAdminJwt) {
    return json({ success: false, error: 'Forbidden', message: 'صلاحيات الإدارة مطلوبة' }, 403);
  }

  // Parse Firebase service account for notifications
  let fcmServiceAccount = null;
  const fcmProjectId = config.FIREBASE_PROJECT_ID || 'coffee-spark-ai-barista-1b800';
  try {
    if (config.FIREBASE_SERVICE_ACCOUNT) {
      fcmServiceAccount = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT);
    }
  } catch { /* FCM not configured */ }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. GET /api/v2/admin/stats — إحصائيات عامة للمنصة
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'stats' && method === 'GET') {
    const listingStats = await queryNeon(`
      SELECT
        COUNT(*) as total_listings,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_listings,
        COUNT(*) FILTER (WHERE status = 'published') as published_listings,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_listings,
        COUNT(*) FILTER (WHERE status = 'sold') as sold_listings,
        COUNT(*) FILTER (WHERE is_featured = true) as featured_listings,
        COALESCE(SUM(views_count), 0) as total_views
      FROM listings
    `);

    const userStats = await queryNeon(`
      SELECT
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE is_banned = true) as banned_users,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') as new_users_30d
      FROM app_users
    `);

    const reportStats = await queryNeon(`
      SELECT
        COUNT(*) as total_reports,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_reports
      FROM listing_reports
    `);

    const catStats = await queryNeon(`
      SELECT COUNT(*) as total_categories FROM marketplace_categories WHERE is_active = true
    `);

    return json({
      success: true,
      data: {
        listings: listingStats[0] || {},
        users: userStats[0] || {},
        reports: reportStats[0] || {},
        categories: catStats[0] || {},
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. GET /api/v2/admin/listings — قائمة الإعلانات للإدارة مع الفلترة
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'listings' && !id && method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit  = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
    const offset = (page - 1) * limit;
    const search = url.searchParams.get('q');

    let where = status !== 'all' ? `l.status = $1` : `1=1`;
    const params = status !== 'all' ? [status] : [];
    let pi = params.length + 1;

    if (search) {
      where += ` AND (l.title ILIKE $${pi} OR u.display_name ILIKE $${pi} OR u.email ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    const rows = await queryNeon(
      `SELECT
         l.id, l.title, l.description, l.price, l.price_negotiable, l.currency,
         l.listing_type, l.condition, l.city, l.status, l.rejection_reason,
         l.views_count, l.favorites_count, l.is_featured, l.plan_type,
         l.created_at, l.published_at, l.expires_at,
         u.id AS seller_id, u.display_name AS seller_name, u.email AS seller_email, u.phone AS seller_phone,
         mc.name_ar AS category_name, mc.icon AS category_icon,
         (SELECT image_url FROM listing_images WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_image,
         (SELECT json_agg(json_build_object('id', id, 'image_url', image_url, 'is_cover', is_cover, 'sort_order', sort_order))
          FROM listing_images WHERE listing_id = l.id) AS images
       FROM listings l
       LEFT JOIN app_users u ON l.user_id = u.id
       LEFT JOIN marketplace_categories mc ON l.category_id = mc.id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );

    const count = await queryNeon(
      `SELECT COUNT(*) as total FROM listings l LEFT JOIN app_users u ON l.user_id = u.id WHERE ${where}`,
      params
    );

    return json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: parseInt(count[0]?.total || 0),
        pages: Math.ceil(parseInt(count[0]?.total || 0) / limit),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. POST /api/v2/admin/listings/:id/approve — قبول ونشر الإعلان
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'listings' && id && action === 'approve' && method === 'POST') {
    await queryNeon(
      `UPDATE listings SET
         status = 'published',
         rejection_reason = null,
         published_at = now(),
         expires_at = now() + interval '30 days',
         updated_at = now()
       WHERE id = $1`,
      [id]
    );

    const rows = await queryNeon(
      `SELECT l.title, l.user_id, d.fcm_token
       FROM listings l
       LEFT JOIN LATERAL (
         SELECT fcm_token FROM user_devices
         WHERE user_id = l.user_id AND is_active = true
         ORDER BY last_seen_at DESC LIMIT 1
       ) d ON true
       WHERE l.id = $1`,
      [id]
    );

    if (rows.length) {
      const { user_id, title, fcm_token } = rows[0];

      // تسجيل إشعار داخلي
      await queryNeon(
        `INSERT INTO user_notifications (user_id, title, body, type, data, created_at)
         VALUES ($1, $2, $3, 'listing_approved', $4, now())`,
        [
          user_id,
          '✅ تم نشر إعلانك!',
          `تمت الموافقة على إعلانك "${title}" وهو متاح الآن في سوق العاشر.`,
          JSON.stringify({ listing_id: id }),
        ]
      );

      // إرسال Push Notification
      if (fcm_token) {
        await sendFcmPush({
          fcmToken: fcm_token,
          title: '✅ تم نشر إعلانك!',
          body: `إعلانك "${title}" تم قبوله ونُشر الآن في سوق العاشر`,
          data: { listing_id: id, type: 'listing_approved' },
          serviceAccount: fcmServiceAccount,
          projectId: fcmProjectId,
        });
      }
    }

    return json({ success: true, message: 'تم قبول ونشر الإعلان بنجاح وإشعار صاحبه' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. POST /api/v2/admin/listings/:id/reject — رفض الإعلان مع ذكر السبب
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'listings' && id && action === 'reject' && method === 'POST') {
    const { reason = 'لم يستوفِ شروط وسياسة النشر في السوق' } = body || {};

    await queryNeon(
      `UPDATE listings SET
         status = 'rejected',
         rejection_reason = $2,
         updated_at = now()
       WHERE id = $1`,
      [id, reason]
    );

    const rows = await queryNeon(
      `SELECT l.title, l.user_id, d.fcm_token
       FROM listings l
       LEFT JOIN LATERAL (
         SELECT fcm_token FROM user_devices
         WHERE user_id = l.user_id AND is_active = true
         ORDER BY last_seen_at DESC LIMIT 1
       ) d ON true
       WHERE l.id = $1`,
      [id]
    );

    if (rows.length) {
      const { user_id, title, fcm_token } = rows[0];

      // تسجيل إشعار داخلي
      await queryNeon(
        `INSERT INTO user_notifications (user_id, title, body, type, data, created_at)
         VALUES ($1, $2, $3, 'listing_rejected', $4, now())`,
        [
          user_id,
          '❌ تم رفض إعلانك',
          `لم يتم قبول إعلانك "${title}". السبب: ${reason}`,
          JSON.stringify({ listing_id: id, reason }),
        ]
      );

      // إرسال Push Notification
      if (fcm_token) {
        await sendFcmPush({
          fcmToken: fcm_token,
          title: '❌ لم يُقبل إعلانك في السوق',
          body: `السبب: ${reason}`,
          data: { listing_id: id, type: 'listing_rejected', reason },
          serviceAccount: fcmServiceAccount,
          projectId: fcmProjectId,
        });
      }
    }

    return json({ success: true, message: 'تم رفض الإعلان وإشعار صاحبه بالسبب' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. PATCH /api/v2/admin/listings/:id/feature — تمييز الإعلان بنجمة
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'listings' && id && action === 'feature' && (method === 'PATCH' || method === 'POST')) {
    const { is_featured = true } = body || {};

    await queryNeon(
      `UPDATE listings SET is_featured = $1, updated_at = now() WHERE id = $2`,
      [Boolean(is_featured), id]
    );

    return json({ success: true, message: 'تم تحديث حالة تمييز الإعلان' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. DELETE /api/v2/admin/listings/:id — حذف الإعلان جبرياً من الإدارة
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'listings' && id && !action && method === 'DELETE') {
    await queryNeon(`UPDATE listings SET status = 'deleted', updated_at = now() WHERE id = $1`, [id]);
    return json({ success: true, message: 'تم حذف الإعلان بواسطة الإدارة' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. إدارة الأقسام (Marketplace Categories Management)
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'categories') {
    // POST /api/v2/admin/categories — إضافة قسم جديد
    if (!id && method === 'POST') {
      const { name_ar, icon = '📦', sort_order = 0 } = body || {};
      if (!name_ar) return json({ success: false, error: 'name_ar required' }, 400);

      const rows = await queryNeon(
        `INSERT INTO marketplace_categories (name_ar, icon, sort_order, is_active)
         VALUES ($1, $2, $3, true) RETURNING *`,
        [name_ar, icon, sort_order]
      );
      return json({ success: true, data: rows[0], message: 'تمت إضافة القسم بنجاح' });
    }

    // PUT/PATCH /api/v2/admin/categories/:id — تعديل قسم
    if (id && (method === 'PUT' || method === 'PATCH')) {
      const { name_ar, icon, sort_order, is_active } = body || {};
      const updates = [];
      const params = [id];
      let pi = 2;

      if (name_ar !== undefined) { updates.push(`name_ar = $${pi++}`); params.push(name_ar); }
      if (icon !== undefined) { updates.push(`icon = $${pi++}`); params.push(icon); }
      if (sort_order !== undefined) { updates.push(`sort_order = $${pi++}`); params.push(parseInt(sort_order)); }
      if (is_active !== undefined) { updates.push(`is_active = $${pi++}`); params.push(Boolean(is_active)); }

      if (updates.length === 0) return json({ success: false, error: 'No fields provided' }, 400);

      const rows = await queryNeon(
        `UPDATE marketplace_categories SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );
      return json({ success: true, data: rows[0], message: 'تم تعديل القسم بنجاح' });
    }

    // DELETE /api/v2/admin/categories/:id — حذف أو تعطيل قسم
    if (id && method === 'DELETE') {
      await queryNeon(`UPDATE marketplace_categories SET is_active = false WHERE id = $1`, [id]);
      return json({ success: true, message: 'تم تعطيل القسم' });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. إدارة البلاغات (Reports Moderation)
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'reports') {
    // GET /api/v2/admin/reports — قائمة البلاغات
    if (!id && method === 'GET') {
      const status = url.searchParams.get('status') || 'pending';
      const rows = await queryNeon(
        `SELECT
           r.id, r.listing_id, r.reason, r.details, r.status, r.created_at,
           l.title AS listing_title, l.status AS listing_status,
           u.display_name AS reporter_name, u.email AS reporter_email,
           seller.display_name AS seller_name, seller.email AS seller_email
         FROM listing_reports r
         LEFT JOIN listings l ON r.listing_id = l.id
         LEFT JOIN app_users u ON r.reporter_id = u.id
         LEFT JOIN app_users seller ON l.user_id = seller.id
         WHERE r.status = $1
         ORDER BY r.created_at DESC`,
        [status]
      );
      return json({ success: true, data: rows });
    }

    // PATCH /api/v2/admin/reports/:id — معالجة البلاغ (reviewed / dismissed)
    if (id && (method === 'PATCH' || method === 'POST')) {
      const { status = 'reviewed' } = body || {};
      await queryNeon(`UPDATE listing_reports SET status = $1 WHERE id = $2`, [status, id]);
      return json({ success: true, message: 'تم تحديث حالة البلاغ' });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. إدارة المستخدمين (Users Moderation)
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'users') {
    // GET /api/v2/admin/users — جلب قائمة المستخدمين
    if (!id && method === 'GET') {
      const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit  = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
      const offset = (page - 1) * limit;
      const search = url.searchParams.get('q');

      let where = `1=1`;
      const params = [];
      let pi = 1;

      if (search) {
        where += ` AND (display_name ILIKE $${pi} OR email ILIKE $${pi} OR phone ILIKE $${pi})`;
        params.push(`%${search}%`);
        pi++;
      }

      const rows = await queryNeon(
        `SELECT
           id, google_id, email, display_name, avatar_url, phone, city,
           role, is_verified, is_active, is_banned, last_login_at, created_at,
           (SELECT COUNT(*) FROM listings WHERE user_id = app_users.id) AS listings_count
         FROM app_users
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      );

      const count = await queryNeon(`SELECT COUNT(*) as total FROM app_users WHERE ${where}`, params);

      return json({
        success: true,
        data: rows,
        pagination: { page, limit, total: parseInt(count[0]?.total || 0) },
      });
    }

    // PATCH /api/v2/admin/users/:id/verify — توثيق الحساب أو إلغاء التوثيق (العلامة الذهبية)
    if (id && action === 'verify' && (method === 'PATCH' || method === 'POST')) {
      const { is_verified = true } = body || {};
      await queryNeon(
        `UPDATE app_users SET is_verified = $1, updated_at = now() WHERE id = $2`,
        [Boolean(is_verified), id]
      );
      return json({
        success: true,
        message: is_verified ? 'تم توثيق الحساب ومنح الشارة الذهبية بنجاح' : 'تم إلغاء توثيق الحساب',
      });
    }

    // PATCH /api/v2/admin/users/:id/ban — حظر أو فك حظر المستخدم
    if (id && action === 'ban' && (method === 'PATCH' || method === 'POST')) {
      const { is_banned = true } = body || {};
      await queryNeon(
        `UPDATE app_users SET is_banned = $1, updated_at = now() WHERE id = $2`,
        [Boolean(is_banned), id]
      );
      return json({
        success: true,
        message: is_banned ? 'تم حظر المستخدم بنجاح' : 'تم إلغاء حظر المستخدم',
      });
    }

    // PATCH /api/v2/admin/users/:id/role — تعيين الرتبة (user / moderator / admin)
    if (id && action === 'role' && (method === 'PATCH' || method === 'POST')) {
      const { role } = body || {};
      if (!['user', 'moderator', 'admin'].includes(role)) {
        return json({ success: false, error: 'Invalid role' }, 400);
      }
      await queryNeon(
        `UPDATE app_users SET role = $1, updated_at = now() WHERE id = $2`,
        [role, id]
      );
      return json({ success: true, message: `تم تعديل رتبة المستخدم إلى ${role}` });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. POST /api/v2/admin/notifications/broadcast — إرسال إشعار عام للجميع
  // ══════════════════════════════════════════════════════════════════════════
  if (resource === 'notifications' && id === 'broadcast' && method === 'POST') {
    const { title, body: msgBody, type = 'general_announcement' } = body || {};
    if (!title || !msgBody) {
      return json({ success: false, error: 'title and body required' }, 400);
    }

    // جلب جميع المستخدمين النشطين
    const users = await queryNeon(`SELECT id FROM app_users WHERE is_active = true AND is_banned = false`);

    for (const u of users) {
      await queryNeon(
        `INSERT INTO user_notifications (user_id, title, body, type, data, created_at)
         VALUES ($1, $2, $3, $4, '{}', now())`,
        [u.id, title, msgBody, type]
      );
    }

    return json({
      success: true,
      message: `تم إرسال الإشعار لـ ${users.length} مستخدم بنجاح`,
    });
  }

  return false;
}
