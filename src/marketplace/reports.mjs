/**
 * src/marketplace/reports.mjs
 * إدارة بلاغات وشكاوى الإعلانات المخالفة
 */

export async function handleReportRoutes({
  pathname,
  method,
  body,
  json,
  queryNeon,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'marketplace', 'listings', ':id', 'report']
  const [, , feature, sub, id, action] = segments;

  if (feature !== 'marketplace' || sub !== 'listings' || !id || action !== 'report') {
    return false;
  }

  if (method === 'POST') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const { reason, details } = body || {};
    const validReasons = ['spam', 'fraud', 'inappropriate', 'duplicate', 'wrong_category', 'other'];

    if (!reason || !validReasons.includes(reason)) {
      return json({
        success: false,
        error: 'invalid_reason',
        message: 'سبب الإبلاغ غير صالح أو غير محدد',
      }, 400);
    }

    // تحقق من وجود الإعلان
    const listingCheck = await queryNeon(`SELECT id, title FROM listings WHERE id = $1`, [id]);
    if (!listingCheck.length) {
      return json({ success: false, error: 'Listing not found' }, 404);
    }

    await queryNeon(
      `INSERT INTO listing_reports (listing_id, reporter_id, reason, details, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', now())
       ON CONFLICT (listing_id, reporter_id) DO UPDATE SET
         reason = EXCLUDED.reason,
         details = EXCLUDED.details,
         status = 'pending'`,
      [id, authUser.sub, reason, details ? String(details).trim() : null]
    );

    return json({
      success: true,
      message: 'شكراً لك، تم إرسال البلاغ وسيقوم فريق المراجعة بفحصه لاتخاذ الإجراء المناسب',
    });
  }

  return false;
}
