/**
 * src/marketplace/categories.mjs
 * مسارات وتصنيفات سوق القوة العاشرة
 */

export async function handleCategoryRoutes({
  pathname,
  method,
  json,
  queryNeon,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'marketplace', 'categories', ...]
  const [, , feature, sub, id] = segments;

  if (feature !== 'marketplace' || sub !== 'categories') return false;

  // ── GET /api/v2/marketplace/categories ──────────────────────────────────────
  if (!id && method === 'GET') {
    const rows = await queryNeon(
      `SELECT
         c.id, c.name_ar, c.icon, c.sort_order, c.is_active, c.created_at,
         COUNT(l.id) FILTER (WHERE l.status = 'published') AS published_listings_count
       FROM marketplace_categories c
       LEFT JOIN listings l ON l.category_id = c.id
       WHERE c.is_active = true
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name_ar ASC`
    );

    return json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name_ar: r.name_ar,
        icon: r.icon,
        sort_order: r.sort_order,
        listings_count: parseInt(r.published_listings_count || 0),
      })),
    });
  }

  // ── GET /api/v2/marketplace/categories/:id ──────────────────────────────────
  if (id && method === 'GET') {
    const rows = await queryNeon(
      `SELECT
         c.id, c.name_ar, c.icon, c.sort_order, c.is_active, c.created_at,
         COUNT(l.id) FILTER (WHERE l.status = 'published') AS published_listings_count
       FROM marketplace_categories c
       LEFT JOIN listings l ON l.category_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [id]
    );

    if (!rows.length) return json({ success: false, error: 'Category not found' }, 404);

    const r = rows[0];
    return json({
      success: true,
      data: {
        id: r.id,
        name_ar: r.name_ar,
        icon: r.icon,
        sort_order: r.sort_order,
        is_active: r.is_active,
        listings_count: parseInt(r.published_listings_count || 0),
      },
    });
  }

  return false;
}
