/**
 * src/marketplace/notifications.mjs
 * إدارة الإشعارات داخل التطبيق (جلب، تحديد كمقروء، وحذف)
 */

export async function handleNotificationRoutes({
  pathname,
  method,
  url,
  json,
  queryNeon,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'notifications', ...]
  const [, , feature, id, action] = segments;

  if (feature !== 'notifications') return false;

  if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

  // ── GET /api/v2/notifications — جلب إشعارات المستخدم ─────────────────────────
  if (!id && method === 'GET') {
    const page  = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
    const offset = (page - 1) * limit;

    const rows = await queryNeon(
      `SELECT id, title, body, type, data, is_read, created_at
       FROM user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [authUser.sub, limit, offset]
    );

    const unreadCount = await queryNeon(
      `SELECT COUNT(*) as unread FROM user_notifications
       WHERE user_id = $1 AND is_read = false`,
      [authUser.sub]
    );

    return json({
      success: true,
      data: rows,
      unread_count: parseInt(unreadCount[0]?.unread || 0),
      pagination: { page, limit },
    });
  }

  // ── PATCH /api/v2/notifications/read-all — تحديد كل الإشعارات كمقروءة ───────
  if (id === 'read-all' && (method === 'PATCH' || method === 'POST')) {
    await queryNeon(
      `UPDATE user_notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [authUser.sub]
    );
    return json({ success: true, message: 'تم تحديد جميع الإشعارات كمقروءة' });
  }

  // ── PATCH /api/v2/notifications/:id/read — تحديد إشعار كمقروء ───────────────
  if (id && action === 'read' && (method === 'PATCH' || method === 'POST')) {
    await queryNeon(
      `UPDATE user_notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [id, authUser.sub]
    );
    return json({ success: true, message: 'تم التحديد كمقروء' });
  }

  // ── DELETE /api/v2/notifications/:id — حذف إشعار ────────────────────────────
  if (id && !action && method === 'DELETE') {
    await queryNeon(
      `DELETE FROM user_notifications WHERE id = $1 AND user_id = $2`,
      [id, authUser.sub]
    );
    return json({ success: true, message: 'تم حذف الإشعار' });
  }

  return false;
}
