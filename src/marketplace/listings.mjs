/**
 * src/marketplace/listings.mjs
 * إدارة الإعلانات بالكامل — عرض، إنشاء، تعديل، حذف، تجديد، وتحديث الحالة
 */
import { randomUUID } from 'node:crypto';
import { deleteFromR2 } from '../lib/r2.mjs';

export async function handleListingRoutes({
  pathname,
  method,
  url,
  body,
  json,
  queryNeon,
  authUser,
  notifyTelegramAdmins,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'marketplace', 'listings', ...]
  const [, , feature, sub, id, action] = segments;

  if (feature !== 'marketplace' || sub !== 'listings') return false;

  // ══════════════════════════════════════════════════════════════════════════
  // 1. GET /api/v2/marketplace/listings — خلاصات وتصفية الإعلانات المنشورة
  // ══════════════════════════════════════════════════════════════════════════
  if (!id && method === 'GET') {
    const page      = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit     = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
    const offset    = (page - 1) * limit;
    const cat       = url.searchParams.get('category');
    const type      = url.searchParams.get('type');           // sale | wanted
    const search    = url.searchParams.get('q');
    const city      = url.searchParams.get('city');
    const condition = url.searchParams.get('condition');      // new | like_new | good | fair | for_parts
    const minPrice  = url.searchParams.get('min_price');
    const maxPrice  = url.searchParams.get('max_price');
    const sort      = url.searchParams.get('sort') || 'featured_newest'; // newest, price_asc, price_desc, views

    let where = `l.status = 'published'`;
    const params = [];
    let pi = 1;

    if (cat) {
      where += ` AND l.category_id = $${pi++}`;
      params.push(cat);
    }
    if (type) {
      where += ` AND l.listing_type = $${pi++}`;
      params.push(type);
    }
    if (city) {
      where += ` AND l.city ILIKE $${pi++}`;
      params.push(`%${city}%`);
    }
    if (condition) {
      where += ` AND l.condition = $${pi++}`;
      params.push(condition);
    }
    if (minPrice && !isNaN(parseFloat(minPrice))) {
      where += ` AND l.price >= $${pi++}`;
      params.push(parseFloat(minPrice));
    }
    if (maxPrice && !isNaN(parseFloat(maxPrice))) {
      where += ` AND l.price <= $${pi++}`;
      params.push(parseFloat(maxPrice));
    }
    if (search) {
      where += ` AND (l.title ILIKE $${pi} OR l.description ILIKE $${pi} OR l.city ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    // Sorting
    let orderBy = `l.is_featured DESC, l.published_at DESC NULLS LAST, l.created_at DESC`;
    if (sort === 'price_asc') orderBy = `l.price ASC NULLS LAST`;
    if (sort === 'price_desc') orderBy = `l.price DESC NULLS LAST`;
    if (sort === 'views') orderBy = `l.views_count DESC, l.published_at DESC`;
    if (sort === 'newest') orderBy = `l.published_at DESC NULLS LAST, l.created_at DESC`;

    const authUserId = authUser?.sub || null;
    const favoriteSelect = authUserId
      ? `EXISTS(SELECT 1 FROM listing_favorites WHERE user_id = '${authUserId}' AND listing_id = l.id) AS is_favorited`
      : `false AS is_favorited`;

    const rows = await queryNeon(
      `SELECT
         l.id, l.user_id, l.category_id, l.title, l.description,
         l.price, l.price_negotiable, l.currency, l.listing_type, l.condition,
         l.city, l.location_lat, l.location_lng,
         l.show_phone, l.show_whatsapp, l.show_telegram,
         l.status, l.views_count, l.favorites_count,
         l.is_featured, l.plan_type, l.published_at, l.expires_at, l.created_at,
         u.display_name AS seller_name, u.avatar_url AS seller_avatar, u.phone AS seller_phone,
         COALESCE(u.is_verified, false) AS seller_is_verified,
         mc.name_ar AS category_name, mc.icon AS category_icon,
         (SELECT image_url FROM listing_images WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_image,
         (SELECT json_agg(json_build_object('id', id, 'image_url', image_url, 'is_cover', is_cover, 'sort_order', sort_order))
          FROM listing_images WHERE listing_id = l.id) AS images,
         ${favoriteSelect}
       FROM listings l
       LEFT JOIN app_users u ON l.user_id = u.id
       LEFT JOIN marketplace_categories mc ON l.category_id = mc.id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );

    const countRows = await queryNeon(
      `SELECT COUNT(*) as total FROM listings l WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0]?.total || 0);

    return json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. GET /api/v2/marketplace/listings/:id — تفاصيل إعلان محدد
  // ══════════════════════════════════════════════════════════════════════════
  if (id && !action && method === 'GET') {
    // زيادة عدد المشاهدات
    await queryNeon(
      `UPDATE listings SET views_count = views_count + 1 WHERE id = $1`,
      [id]
    );

    const authUserId = authUser?.sub || null;
    const favoriteSelect = authUserId
      ? `EXISTS(SELECT 1 FROM listing_favorites WHERE user_id = '${authUserId}' AND listing_id = l.id) AS is_favorited`
      : `false AS is_favorited`;

    // السماح للمالك بمشاهدة إعلانه حتى لو لم يكن published
    const rows = await queryNeon(
      `SELECT
         l.*,
         u.display_name AS seller_name,
         u.avatar_url AS seller_avatar,
         u.phone AS seller_phone,
         u.bio AS seller_bio,
         u.city AS seller_city,
         u.created_at AS seller_joined_at,
         COALESCE(u.is_verified, false) AS seller_is_verified,
         (SELECT COUNT(*) FROM listings WHERE user_id = u.id AND status = 'published') AS seller_active_listings_count,
         mc.name_ar AS category_name,
         mc.icon AS category_icon,
         ${favoriteSelect}
       FROM listings l
       LEFT JOIN app_users u ON l.user_id = u.id
       LEFT JOIN marketplace_categories mc ON l.category_id = mc.id
       WHERE l.id = $1 AND (l.status = 'published' OR l.user_id = $2 OR $3 = 'admin')`,
      [id, authUserId || '00000000-0000-0000-0000-000000000000', authUser?.role || 'user']
    );

    if (!rows.length) {
      return json({ success: false, error: 'Listing not found or unavailable' }, 404);
    }

    const listing = rows[0];

    // جلب جميع الصور مرتبة
    const images = await queryNeon(
      `SELECT id, image_url, storage_key, sort_order, is_cover
       FROM listing_images
       WHERE listing_id = $1
       ORDER BY is_cover DESC, sort_order ASC, created_at ASC`,
      [id]
    );

    // جلب إعلانات مشابهة في نفس القسم
    let similar = [];
    if (listing.category_id) {
      similar = await queryNeon(
        `SELECT
           l.id, l.title, l.price, l.currency, l.city, l.listing_type, l.is_featured,
           (SELECT image_url FROM listing_images WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_image
         FROM listings l
         WHERE l.category_id = $1 AND l.id != $2 AND l.status = 'published'
         ORDER BY l.published_at DESC LIMIT 4`,
        [listing.category_id, id]
      );
    }

    return json({
      success: true,
      data: {
        ...listing,
        images,
        similar_listings: similar,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. POST /api/v2/marketplace/listings — إنشاء إعلان جديد
  // ══════════════════════════════════════════════════════════════════════════
  if (!id && method === 'POST') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const {
      title,
      description,
      price,
      price_negotiable = false,
      currency = 'SAR',
      listing_type = 'sale',
      condition,
      city,
      location_lat,
      location_lng,
      category_id,
      show_phone = true,
      show_whatsapp = true,
      show_telegram = false,
      images = [], // Array of { image_url/url, is_cover, storage_key, sort_order } or strings
    } = body || {};

    if (!title || !String(title).trim()) {
      return json({ success: false, error: 'title_required', message: 'عنوان الإعلان مطلوب' }, 400);
    }
    if (images.length > 5) {
      return json({ success: false, error: 'max_images_exceeded', message: 'الحد الأقصى للصور هو 5 صور' }, 400);
    }

    // فحص حد الإعلانات النشطة للمستخدم (10 كحد أقصى)
    const activeCount = await queryNeon(
      `SELECT COUNT(*) as c FROM listings WHERE user_id = $1 AND status IN ('pending', 'published')`,
      [authUser.sub]
    );
    if (parseInt(activeCount[0]?.c || 0) >= 15) {
      return json({
        success: false,
        error: 'max_listings_reached',
        message: 'لقد بلغت الحد الأقصى للإعلانات النشطة والمعلقة (15 إعلان)',
      }, 429);
    }

    const listingId = randomUUID();

    await queryNeon(
      `INSERT INTO listings (
         id, user_id, category_id, title, description, price, price_negotiable,
         currency, listing_type, condition, city, location_lat, location_lng,
         show_phone, show_whatsapp, show_telegram, status, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14, $15, $16, 'pending', now(), now()
       )`,
      [
        listingId,
        authUser.sub,
        category_id || null,
        String(title).trim(),
        description ? String(description).trim() : null,
        price !== undefined && price !== null && price !== '' ? parseFloat(price) : null,
        Boolean(price_negotiable),
        currency || 'SAR',
        listing_type === 'wanted' ? 'wanted' : 'sale',
        condition || null,
        city ? String(city).trim() : null,
        location_lat ? parseFloat(location_lat) : null,
        location_lng ? parseFloat(location_lng) : null,
        Boolean(show_phone),
        Boolean(show_whatsapp),
        Boolean(show_telegram),
      ]
    );

    // إضافة الصور في جدول listing_images
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const imgUrl = typeof img === 'string' ? img : (img.image_url || img.url);
        const storageKey = typeof img === 'object' ? img.storage_key : null;
        const isCover = typeof img === 'object' ? Boolean(img.is_cover || i === 0) : i === 0;

        if (imgUrl) {
          await queryNeon(
            `INSERT INTO listing_images (listing_id, image_url, storage_key, sort_order, is_cover)
             VALUES ($1, $2, $3, $4, $5)`,
            [listingId, imgUrl, storageKey || null, i, isCover]
          );
        }
      }
    }

    // إشعار تيليجرام للأدمن عند وصول إعلان جديد للمراجعة
    if (notifyTelegramAdmins) {
      try {
        const userRow = await queryNeon(`SELECT display_name FROM app_users WHERE id = $1`, [authUser.sub]);
        await notifyTelegramAdmins({
          type: 'new_listing',
          listing_id: listingId,
          title: String(title).trim(),
          seller: userRow[0]?.display_name || authUser.email,
          city: city || '',
        });
      } catch (err) {
        console.warn('Telegram notify error:', err.message);
      }
    }

    return json({
      success: true,
      data: {
        id: listingId,
        status: 'pending',
        message: 'تم إرسال إعلانك بنجاح وهو قيد المراجعة للنشر',
      },
    }, 201);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. PUT/PATCH /api/v2/marketplace/listings/:id — تعديل إعلان
  // ══════════════════════════════════════════════════════════════════════════
  if (id && !action && (method === 'PUT' || method === 'PATCH')) {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const check = await queryNeon(`SELECT user_id, status FROM listings WHERE id = $1`, [id]);
    if (!check.length) return json({ success: false, error: 'Listing not found' }, 404);

    if (check[0].user_id !== authUser.sub && authUser.role !== 'admin') {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    const {
      title,
      description,
      price,
      price_negotiable,
      currency,
      listing_type,
      condition,
      city,
      location_lat,
      location_lng,
      category_id,
      show_phone,
      show_whatsapp,
      show_telegram,
      images,
    } = body || {};

    const updates = [];
    const params = [id];
    let pi = 2;

    if (title !== undefined) {
      updates.push(`title = $${pi++}`);
      params.push(String(title).trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${pi++}`);
      params.push(description ? String(description).trim() : null);
    }
    if (price !== undefined) {
      updates.push(`price = $${pi++}`);
      params.push(price !== null && price !== '' ? parseFloat(price) : null);
    }
    if (price_negotiable !== undefined) {
      updates.push(`price_negotiable = $${pi++}`);
      params.push(Boolean(price_negotiable));
    }
    if (currency !== undefined) {
      updates.push(`currency = $${pi++}`);
      params.push(currency);
    }
    if (listing_type !== undefined) {
      updates.push(`listing_type = $${pi++}`);
      params.push(listing_type);
    }
    if (condition !== undefined) {
      updates.push(`condition = $${pi++}`);
      params.push(condition || null);
    }
    if (city !== undefined) {
      updates.push(`city = $${pi++}`);
      params.push(city ? String(city).trim() : null);
    }
    if (location_lat !== undefined) {
      updates.push(`location_lat = $${pi++}`);
      params.push(location_lat ? parseFloat(location_lat) : null);
    }
    if (location_lng !== undefined) {
      updates.push(`location_lng = $${pi++}`);
      params.push(location_lng ? parseFloat(location_lng) : null);
    }
    if (category_id !== undefined) {
      updates.push(`category_id = $${pi++}`);
      params.push(category_id || null);
    }
    if (show_phone !== undefined) {
      updates.push(`show_phone = $${pi++}`);
      params.push(Boolean(show_phone));
    }
    if (show_whatsapp !== undefined) {
      updates.push(`show_whatsapp = $${pi++}`);
      params.push(Boolean(show_whatsapp));
    }
    if (show_telegram !== undefined) {
      updates.push(`show_telegram = $${pi++}`);
      params.push(Boolean(show_telegram));
    }

    updates.push(`updated_at = now()`);

    await queryNeon(
      `UPDATE listings SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    // تحديث الصور إذا أُرسلت (مع حذف الصور المستبعدة من سيرفر التخزين R2)
    if (Array.isArray(images)) {
      const existingImages = await queryNeon(
        `SELECT image_url, storage_key FROM listing_images WHERE listing_id = $1`,
        [id]
      );

      const newUrls = new Set(
        images.map(img => typeof img === 'string' ? img : (img.image_url || img.url)).filter(Boolean)
      );

      for (const oldImg of existingImages) {
        if (!newUrls.has(oldImg.image_url)) {
          // تم استبعاد وحذف هذه الصورة -> حذفها من سيرفر التخزين R2
          await deleteFromR2(oldImg.storage_key || oldImg.image_url);
        }
      }

      await queryNeon(`DELETE FROM listing_images WHERE listing_id = $1`, [id]);
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const imgUrl = typeof img === 'string' ? img : (img.image_url || img.url);
        const storageKey = typeof img === 'object' ? img.storage_key : null;
        const isCover = typeof img === 'object' ? Boolean(img.is_cover || i === 0) : i === 0;

        if (imgUrl) {
          await queryNeon(
            `INSERT INTO listing_images (listing_id, image_url, storage_key, sort_order, is_cover)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, imgUrl, storageKey || null, i, isCover]
          );
        }
      }
    }

    return json({ success: true, message: 'تم تحديث الإعلان بنجاح' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. PATCH /api/v2/marketplace/listings/:id/status — تحديث حالة الإعلان
  // ⚠️ المستخدم يستطيع فقط: sold (تم البيع), closed (إغلاق), deleted (حذف)
  // ❌ لا يستطيع المستخدم قبول إعلانه (published) أو رفضه (rejected)
  // ══════════════════════════════════════════════════════════════════════════
  if (id && action === 'status' && (method === 'PATCH' || method === 'POST')) {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const { status } = body || {};
    const allowedForUser = ['sold', 'closed', 'deleted'];

    const check = await queryNeon(`SELECT user_id, status FROM listings WHERE id = $1`, [id]);
    if (!check.length) return json({ success: false, error: 'Listing not found' }, 404);

    const isOwner = check[0].user_id === authUser.sub;
    const isAdmin = authUser.role === 'admin';

    if (!isOwner && !isAdmin) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    if (!isAdmin && !allowedForUser.includes(status)) {
      return json({
        success: false,
        error: 'invalid_status_transition',
        message: 'لا تملك صلاحية تحويل الإعلان لهذه الحالة',
      }, 400);
    }

    await queryNeon(
      `UPDATE listings SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id]
    );

    return json({
      success: true,
      data: { id, status },
      message: 'تم تحديث حالة الإعلان بنجاح',
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. POST /api/v2/marketplace/listings/:id/renew — تجديد الإعلان 30 يوماً
  // ══════════════════════════════════════════════════════════════════════════
  if (id && action === 'renew' && method === 'POST') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const check = await queryNeon(`SELECT user_id FROM listings WHERE id = $1`, [id]);
    if (!check.length) return json({ success: false, error: 'Listing not found' }, 404);

    if (check[0].user_id !== authUser.sub && authUser.role !== 'admin') {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    await queryNeon(
      `UPDATE listings SET expires_at = now() + interval '30 days', updated_at = now() WHERE id = $1`,
      [id]
    );

    return json({ success: true, message: 'تم تجديد الإعلان بنجاح لمدة 30 يوماً' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. DELETE /api/v2/marketplace/listings/:id — حذف الإعلان (Soft Delete)
  // ══════════════════════════════════════════════════════════════════════════
  if (id && !action && method === 'DELETE') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const check = await queryNeon(`SELECT user_id FROM listings WHERE id = $1`, [id]);
    if (!check.length) return json({ success: false, error: 'Listing not found' }, 404);

    if (check[0].user_id !== authUser.sub && authUser.role !== 'admin') {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    // حذف صور الإعلان من سيرفر التخزين R2
    try {
      const existingImages = await queryNeon(
        `SELECT image_url, storage_key FROM listing_images WHERE listing_id = $1`,
        [id]
      );
      for (const img of existingImages) {
        await deleteFromR2(img.storage_key || img.image_url);
      }
      await queryNeon(`DELETE FROM listing_images WHERE listing_id = $1`, [id]);
    } catch (err) {
      console.warn('Failed to clean up images from R2 on delete:', err.message);
    }

    await queryNeon(
      `UPDATE listings SET status = 'deleted', updated_at = now() WHERE id = $1`,
      [id]
    );

    return json({ success: true, message: 'تم حذف الإعلان بنجاح' });
  }

  return false;
}
