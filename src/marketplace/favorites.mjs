/**
 * src/marketplace/favorites.mjs
 * إدارة الإعلانات المفضلة (إضافة / إزالة)
 */

export async function handleFavoriteRoutes({
  pathname,
  method,
  json,
  queryNeon,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'marketplace', 'listings', ':id', 'favorite']
  const [, , feature, sub, id, action] = segments;

  if (feature !== 'marketplace' || sub !== 'listings' || !id || action !== 'favorite') {
    return false;
  }

  if (method === 'POST') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const exists = await queryNeon(
      `SELECT id FROM listing_favorites WHERE user_id = $1 AND listing_id = $2`,
      [authUser.sub, id]
    );

    if (exists.length > 0) {
      // إزالة من المفضلة
      await queryNeon(
        `DELETE FROM listing_favorites WHERE user_id = $1 AND listing_id = $2`,
        [authUser.sub, id]
      );
      await queryNeon(
        `UPDATE listings SET favorites_count = GREATEST(0, favorites_count - 1) WHERE id = $1`,
        [id]
      );

      const count = await queryNeon(`SELECT favorites_count FROM listings WHERE id = $1`, [id]);
      return json({
        success: true,
        favorited: false,
        favorites_count: count[0]?.favorites_count || 0,
        message: 'تم إلغاء الإعجاب',
      });
    } else {
      // إضافة للمفضلة
      await queryNeon(
        `INSERT INTO listing_favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [authUser.sub, id]
      );
      await queryNeon(
        `UPDATE listings SET favorites_count = favorites_count + 1 WHERE id = $1`,
        [id]
      );

      const count = await queryNeon(`SELECT favorites_count FROM listings WHERE id = $1`, [id]);
      return json({
        success: true,
        favorited: true,
        favorites_count: count[0]?.favorites_count || 1,
        message: 'تم الإعجاب',
      });
    }
  }

  return false;
}
