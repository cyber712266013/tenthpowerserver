/**
 * src/marketplace/user.mjs
 * مسارات الملف الشخصي، إعلانات المستخدم، المفضلة، ومعاينة البائعين
 */

export async function handleUserRoutes({
  pathname,
  method,
  url,
  body,
  json,
  queryNeon,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'me'...] or ['api', 'v2', 'users'...]
  const [, , feature, ...rest] = segments;

  // ══════════════════════════════════════════════════════════════════════════
  // /api/v2/me
  // ══════════════════════════════════════════════════════════════════════════
  if (feature === 'me') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    // ── GET /api/v2/me — الملف الشخصي للمستخدم الحالي ────────────────────────
    if (rest.length === 0 && method === 'GET') {
      const rows = await queryNeon(
        `SELECT
           u.id, u.google_id, u.email, u.display_name, u.avatar_url,
           u.phone, u.bio, u.city, u.social_links, u.role, u.is_verified,
           u.is_active, u.is_banned, u.last_login_at, u.created_at, u.updated_at,
           (SELECT COUNT(*) FROM listings WHERE user_id = u.id AND status != 'deleted') AS total_listings,
           (SELECT COUNT(*) FROM listings WHERE user_id = u.id AND status = 'published') AS active_listings,
           (SELECT COUNT(*) FROM listing_favorites WHERE user_id = u.id) AS total_favorites
         FROM app_users u
         WHERE u.id = $1`,
        [authUser.sub]
      );

      if (!rows.length) return json({ success: false, error: 'User not found' }, 404);
      return json({ success: true, data: rows[0] });
    }

    // ── PUT/PATCH /api/v2/me — تحديث الملف الشخصي ───────────────────────────
    if (rest.length === 0 && (method === 'PUT' || method === 'PATCH')) {
      const {
        display_name,
        phone,
        bio,
        city,
        avatar_url,
        social_links,
      } = body || {};

      const updates = [];
      const params = [authUser.sub];
      let pi = 2;

      if (display_name !== undefined) {
        updates.push(`display_name = $${pi++}`);
        params.push(display_name ? String(display_name).trim() : null);
      }
      if (phone !== undefined) {
        updates.push(`phone = $${pi++}`);
        params.push(phone ? String(phone).trim() : null);
      }
      if (bio !== undefined) {
        updates.push(`bio = $${pi++}`);
        params.push(bio ? String(bio).trim() : null);
      }
      if (city !== undefined) {
        updates.push(`city = $${pi++}`);
        params.push(city ? String(city).trim() : null);
      }
      if (avatar_url !== undefined) {
        updates.push(`avatar_url = $${pi++}`);
        params.push(avatar_url);
      }
      if (social_links !== undefined) {
        updates.push(`social_links = $${pi++}`);
        params.push(JSON.stringify(social_links));
      }

      if (updates.length === 0) {
        return json({ success: false, error: 'No fields provided to update' }, 400);
      }

      updates.push(`updated_at = now()`);

      const rows = await queryNeon(
        `UPDATE app_users SET ${updates.join(', ')} WHERE id = $1
         RETURNING id, google_id, email, display_name, avatar_url, phone, bio, city, social_links, role, is_verified, updated_at`,
        params
      );

      return json({
        success: true,
        data: rows[0],
        message: 'تم تحديث البيانات بنجاح',
      });
    }

    // ── GET /api/v2/me/listings — إعلانات المستخدم ────────────────────────────
    if (rest[0] === 'listings' && method === 'GET') {
      const status = url.searchParams.get('status');
      let where = `l.user_id = $1 AND l.status != 'deleted'`;
      const params = [authUser.sub];

      if (status && status !== 'all') {
        where += ` AND l.status = $2`;
        params.push(status);
      }

      const rows = await queryNeon(
        `SELECT
           l.id, l.title, l.description, l.price, l.price_negotiable, l.currency,
           l.listing_type, l.condition, l.city, l.location_lat, l.location_lng,
           l.show_phone, l.show_whatsapp, l.show_telegram,
           l.status, l.rejection_reason, l.views_count, l.favorites_count,
           l.is_featured, l.plan_type, l.published_at, l.expires_at, l.created_at, l.updated_at,
           mc.id AS category_id, mc.name_ar AS category_name, mc.icon AS category_icon,
           (SELECT image_url FROM listing_images WHERE listing_id=l.id AND is_cover=true LIMIT 1) AS cover_image,
           (SELECT json_agg(json_build_object('id', id, 'image_url', image_url, 'is_cover', is_cover, 'sort_order', sort_order))
            FROM listing_images WHERE listing_id=l.id) AS images
         FROM listings l
         LEFT JOIN marketplace_categories mc ON l.category_id=mc.id
         WHERE ${where}
         ORDER BY l.created_at DESC`,
        params
      );

      // Counts per status summary
      const counts = await queryNeon(
        `SELECT
           COUNT(*) FILTER (WHERE status != 'deleted') as all,
           COUNT(*) FILTER (WHERE status = 'published') as published,
           COUNT(*) FILTER (WHERE status = 'pending') as pending,
           COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
           COUNT(*) FILTER (WHERE status = 'sold') as sold,
           COUNT(*) FILTER (WHERE status = 'closed') as closed
         FROM listings WHERE user_id = $1`,
        [authUser.sub]
      );

      return json({
        success: true,
        data: rows,
        summary: counts[0] || {},
      });
    }

    // ── GET /api/v2/me/favorites — قائمة إعلانات المفضلة للمستخدم ───────────────
    if (rest[0] === 'favorites' && method === 'GET') {
      const rows = await queryNeon(
        `SELECT
           l.id, l.title, l.description, l.price, l.price_negotiable, l.currency,
           l.listing_type, l.condition, l.city, l.is_featured, l.views_count, l.favorites_count,
           l.status, l.published_at, l.expires_at, l.created_at,
           u.id AS seller_id, u.display_name AS seller_name, u.avatar_url AS seller_avatar,
           COALESCE(u.is_verified, false) AS seller_is_verified,
           mc.id AS category_id, mc.name_ar AS category_name, mc.icon AS category_icon,
           (SELECT image_url FROM listing_images WHERE listing_id=l.id AND is_cover=true LIMIT 1) AS cover_image,
           true AS is_favorited,
           lf.created_at AS favorited_at
         FROM listing_favorites lf
         JOIN listings l ON lf.listing_id = l.id
         LEFT JOIN app_users u ON l.user_id = u.id
         LEFT JOIN marketplace_categories mc ON l.category_id = mc.id
         WHERE lf.user_id = $1 AND l.status = 'published'
         ORDER BY lf.created_at DESC`,
        [authUser.sub]
      );

      return json({ success: true, data: rows });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /api/v2/users/:id — الملف العام للبائع مع إعلاناته المنشورة
  // ══════════════════════════════════════════════════════════════════════════
  if (feature === 'users' && rest[0] && method === 'GET') {
    const userId = rest[0];

    const userRows = await queryNeon(
      `SELECT
         u.id, u.display_name, u.avatar_url, u.bio, u.city, u.phone,
         u.social_links, u.is_verified, u.created_at,
         (SELECT COUNT(*) FROM listings WHERE user_id = u.id AND status = 'published') AS active_listings_count
       FROM app_users u
       WHERE u.id = $1 AND u.is_active = true AND u.is_banned = false`,
      [userId]
    );

    if (!userRows.length) {
      return json({ success: false, error: 'User not found or unavailable' }, 404);
    }

    const seller = userRows[0];

    const listings = await queryNeon(
      `SELECT
         l.id, l.title, l.price, l.price_negotiable, l.currency,
         l.listing_type, l.condition, l.city, l.is_featured, l.views_count,
         l.published_at,
         mc.name_ar AS category_name, mc.icon AS category_icon,
         (SELECT image_url FROM listing_images WHERE listing_id=l.id AND is_cover=true LIMIT 1) AS cover_image
       FROM listings l
       LEFT JOIN marketplace_categories mc ON l.category_id=mc.id
       WHERE l.user_id = $1 AND l.status = 'published'
       ORDER BY l.published_at DESC`,
      [userId]
    );

    return json({
      success: true,
      data: {
        seller,
        listings,
      },
    });
  }

  return false;
}
