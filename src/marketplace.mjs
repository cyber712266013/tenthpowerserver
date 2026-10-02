/**
 * marketplace.mjs
 * Phase 3 — Marketplace Backend Routes
 *
 * Routes:
 *   POST /api/v2/auth/google          — Verify Google ID Token → issue JWT
 *   POST /api/v2/auth/device          — Register/update FCM token
 *   GET  /api/v2/me                   — Get current user profile
 *
 *   GET  /api/v2/marketplace/categories
 *   GET  /api/v2/marketplace/listings
 *   POST /api/v2/marketplace/listings  (auth required)
 *   GET  /api/v2/marketplace/listings/:id
 *   POST /api/v2/marketplace/listings/:id/favorite (auth required)
 *   POST /api/v2/marketplace/listings/:id/report   (auth required)
 *
 *   POST /api/v2/admin/listings/:id/approve  (admin key required)
 *   POST /api/v2/admin/listings/:id/reject   (admin key required)
 *
 * الاشعارات:
 *   - عند الموافقة/الرفض: FCM Push للمستخدم عبر Firebase Admin
 *   - إشعار Telegram للأدمن عند وصول إعلان جديد
 */

import { createHmac, randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// JWT Utilities (بدون مكتبات خارجية — HMAC-SHA256)
// ─────────────────────────────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function signJwt(payload, secret, expiresInDays = 30) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInDays * 86400,
  }));
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google ID Token Verification (via tokeninfo endpoint)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyGoogleToken(idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );
  if (!res.ok) throw new Error('Invalid Google ID token');
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || 'Google token error');
  return {
    google_id: data.sub,
    email:     data.email,
    name:      data.name,
    picture:   data.picture,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FCM Push Notification (Firebase HTTP v1 API)
// ─────────────────────────────────────────────────────────────────────────────

let _fcmAccessToken = null;
let _fcmTokenExpiry = 0;

async function getFcmAccessToken(serviceAccount) {
  if (_fcmAccessToken && Date.now() < _fcmTokenExpiry) {
    return _fcmAccessToken;
  }

  // JWT for Google OAuth2 service account
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = b64url(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }));

  // Sign with private key using Node.js crypto
  const { createSign } = await import('node:crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claimSet}`);
  const sig = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${header}.${claimSet}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token');

  _fcmAccessToken = tokenData.access_token;
  _fcmTokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;
  return _fcmAccessToken;
}

async function sendFcmPush({ fcmToken, title, body, data = {}, serviceAccount, projectId }) {
  if (!serviceAccount || !fcmToken) return { ok: false, reason: 'missing_config' };

  try {
    const accessToken = await getFcmAccessToken(serviceAccount);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            data: Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, String(v)])
            ),
            android: {
              priority: 'high',
              notification: { sound: 'default', channel_id: 'marketplace' },
            },
          },
        }),
      }
    );
    const result = await res.json();
    return { ok: res.ok, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler — يُستدعى من server.mjs
// ─────────────────────────────────────────────────────────────────────────────

export async function handleMarketplace({
  pathname,
  method,
  url,
  body,
  req,
  json,
  queryNeon,
  config,
  notifyTelegramAdmins,
}) {
  const {
    JWT_SECRET,
    FIREBASE_SERVICE_ACCOUNT: FCM_SA_RAW,
    FIREBASE_PROJECT_ID,
    ADMIN_SECRET_KEY,
  } = config;

  // Parse Firebase service account once
  let fcmServiceAccount = null;
  let fcmProjectId = FIREBASE_PROJECT_ID || 'coffee-spark-ai-barista-1b800';
  try {
    if (FCM_SA_RAW) {
      fcmServiceAccount = JSON.parse(FCM_SA_RAW);
    }
  } catch { /* FCM not configured */ }

  // ── Auth middleware helper ────────────────────────────────────────────────
  function getAuthUser() {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return null;
    return verifyJwt(token, JWT_SECRET);
  }

  function requireAuth() {
    const user = getAuthUser();
    if (!user) {
      json({ success: false, error: 'Unauthorized' }, 401);
      return null;
    }
    return user;
  }

  // ── Segment-based routing ─────────────────────────────────────────────────
  const segments = pathname.replace(/^\//, '').split('/');
  // e.g. ['api','v2','marketplace','listings','abc-id','favorite']
  const [, version, feature, ...rest] = segments;
  if (version !== 'v2') return false; // not our route

  // ══════════════════════════════════════════════════════════════════════════
  // AUTH ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  // POST /api/v2/auth/google
  if (feature === 'auth' && rest[0] === 'google' && method === 'POST') {
    const { id_token } = body || {};
    if (!id_token) return json({ success: false, error: 'id_token required' }, 400);

    try {
      const google = await verifyGoogleToken(id_token);

      // Upsert user
      const rows = await queryNeon(
        `INSERT INTO app_users (google_id, email, display_name, avatar_url, last_login_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (google_id) DO UPDATE SET
           email=EXCLUDED.email,
           display_name=COALESCE(app_users.display_name, EXCLUDED.display_name),
           avatar_url=COALESCE(app_users.avatar_url, EXCLUDED.avatar_url),
           last_login_at=now(),
           updated_at=now()
         RETURNING id, display_name, email, avatar_url, phone, role, is_banned`,
        [google.google_id, google.email, google.name, google.picture]
      );

      const user = rows[0];
      if (user.is_banned) {
        return json({ success: false, error: 'account_banned' }, 403);
      }

      const token = signJwt(
        { sub: user.id, email: user.email, role: user.role },
        JWT_SECRET
      );

      return json({
        success: true,
        data: {
          token,
          user: {
            id:           user.id,
            display_name: user.display_name || google.name,
            email:        user.email,
            avatar_url:   user.avatar_url || google.picture,
            phone:        user.phone,
            role:         user.role,
          },
        },
      });
    } catch (err) {
      return json({ success: false, error: err.message }, 401);
    }
  }

  // POST /api/v2/auth/device — register FCM token
  if (feature === 'auth' && rest[0] === 'device' && method === 'POST') {
    const authUser = requireAuth();
    if (!authUser) return true;

    const { fcm_token, platform, device_model } = body || {};
    if (!fcm_token) return json({ success: false, error: 'fcm_token required' }, 400);

    await queryNeon(
      `INSERT INTO user_devices (user_id, fcm_token, platform, device_model, is_active, last_seen_at)
       VALUES ($1,$2,$3,$4,true,now())
       ON CONFLICT (user_id, fcm_token) DO UPDATE SET
         is_active=true, last_seen_at=now(), platform=EXCLUDED.platform`,
      [authUser.sub, fcm_token, platform, device_model]
    );

    return json({ success: true });
  }

  // GET /api/v2/me
  if (feature === 'me' && method === 'GET') {
    const authUser = requireAuth();
    if (!authUser) return true;

    const rows = await queryNeon(
      `SELECT id, display_name, email, avatar_url, phone, bio, city, role, created_at
       FROM app_users WHERE id=$1`,
      [authUser.sub]
    );
    if (!rows.length) return json({ success: false, error: 'User not found' }, 404);
    return json({ success: true, data: rows[0] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MARKETPLACE ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  if (feature !== 'marketplace' && feature !== 'admin') return false;

  // ── GET /api/v2/marketplace/categories ────────────────────────────────────
  if (feature === 'marketplace' && rest[0] === 'categories' && method === 'GET') {
    const rows = await queryNeon(
      `SELECT id, name_ar, icon, sort_order FROM marketplace_categories
       WHERE is_active=true ORDER BY sort_order ASC`
    );
    return json({ success: true, data: rows });
  }

  // ── GET /api/v2/marketplace/listings ──────────────────────────────────────
  if (feature === 'marketplace' && rest[0] === 'listings' && rest.length === 1 && method === 'GET') {
    const page    = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit   = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
    const offset  = (page - 1) * limit;
    const cat     = url.searchParams.get('category');
    const type    = url.searchParams.get('type');     // sale | wanted
    const search  = url.searchParams.get('q');
    const city    = url.searchParams.get('city');

    let where = `l.status='published'`;
    const params = [];
    let pi = 1;

    if (cat)    { where += ` AND l.category_id=$${pi++}`; params.push(cat); }
    if (type)   { where += ` AND l.listing_type=$${pi++}`; params.push(type); }
    if (city)   { where += ` AND l.city ILIKE $${pi++}`; params.push(`%${city}%`); }
    if (search) {
      where += ` AND (l.title ILIKE $${pi} OR l.description ILIKE $${pi})`;
      params.push(`%${search}%`); pi++;
    }

    const rows = await queryNeon(
      `SELECT
         l.id, l.title, l.price, l.price_negotiable, l.currency,
         l.listing_type, l.condition, l.city, l.is_featured, l.views_count,
         l.published_at, l.expires_at,
         u.display_name AS seller_name, u.avatar_url AS seller_avatar,
         mc.name_ar AS category_name, mc.icon AS category_icon,
         (SELECT image_url FROM listing_images WHERE listing_id=l.id AND is_cover=true LIMIT 1) AS cover_image,
         l.show_whatsapp, l.show_phone, l.show_telegram,
         u.phone AS seller_phone
       FROM listings l
       LEFT JOIN app_users u ON l.user_id=u.id
       LEFT JOIN marketplace_categories mc ON l.category_id=mc.id
       WHERE ${where}
       ORDER BY l.is_featured DESC, l.published_at DESC
       LIMIT $${pi} OFFSET $${pi+1}`,
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
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }

  // ── GET /api/v2/marketplace/listings/:id ──────────────────────────────────
  if (feature === 'marketplace' && rest[0] === 'listings' && rest[1] && !rest[2] && method === 'GET') {
    const listingId = rest[1];

    // زيادة عداد المشاهدات
    await queryNeon(
      `UPDATE listings SET views_count=views_count+1 WHERE id=$1`,
      [listingId]
    );

    const rows = await queryNeon(
      `SELECT
         l.*,
         u.display_name AS seller_name, u.avatar_url AS seller_avatar,
         u.phone AS seller_phone,
         mc.name_ar AS category_name, mc.icon AS category_icon
       FROM listings l
       LEFT JOIN app_users u ON l.user_id=u.id
       LEFT JOIN marketplace_categories mc ON l.category_id=mc.id
       WHERE l.id=$1 AND l.status='published'`,
      [listingId]
    );

    if (!rows.length) return json({ success: false, error: 'Listing not found' }, 404);

    const images = await queryNeon(
      `SELECT image_url, is_cover, sort_order FROM listing_images
       WHERE listing_id=$1 ORDER BY sort_order ASC`,
      [listingId]
    );

    return json({ success: true, data: { ...rows[0], images } });
  }

  // ── POST /api/v2/marketplace/listings — create ────────────────────────────
  if (feature === 'marketplace' && rest[0] === 'listings' && rest.length === 1 && method === 'POST') {
    const authUser = requireAuth();
    if (!authUser) return true;

    const {
      title, description, price, price_negotiable,
      currency = 'SAR', listing_type = 'sale', condition,
      city, category_id, show_phone = true,
      show_whatsapp = true, show_telegram = false,
      images = [], // [{url, is_cover}]
    } = body || {};

    if (!title) return json({ success: false, error: 'title required' }, 400);
    if (images.length > 5) return json({ success: false, error: 'max 5 images' }, 400);

    // حد الإعلانات النشطة للمستخدم (10)
    const activeCount = await queryNeon(
      `SELECT COUNT(*) as c FROM listings WHERE user_id=$1 AND status IN ('pending','published')`,
      [authUser.sub]
    );
    if (parseInt(activeCount[0]?.c || 0) >= 10) {
      return json({ success: false, error: 'max_listings_reached' }, 429);
    }

    const lid = randomUUID();
    await queryNeon(
      `INSERT INTO listings (
         id, user_id, category_id, title, description, price, price_negotiable,
         currency, listing_type, condition, city,
         show_phone, show_whatsapp, show_telegram, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')`,
      [
        lid, authUser.sub, category_id || null,
        title, description, price || null, price_negotiable,
        currency, listing_type, condition || null, city || null,
        show_phone, show_whatsapp, show_telegram,
      ]
    );

    // حفظ الصور
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      await queryNeon(
        `INSERT INTO listing_images (listing_id, image_url, sort_order, is_cover)
         VALUES ($1,$2,$3,$4)`,
        [lid, img.url, i, img.is_cover ?? i === 0]
      );
    }

    // إشعار Telegram للأدمن
    try {
      await notifyTelegramAdmins({
        type: 'new_listing',
        listing_id: lid,
        title,
        seller: authUser.email,
        city: city || '—',
      });
    } catch { /* non-blocking */ }

    return json({
      success: true,
      data: { id: lid, status: 'pending' },
      message: 'تم استلام إعلانك وسيُراجع خلال ساعات قليلة',
    }, 201);
  }

  // ── POST /api/v2/marketplace/listings/:id/favorite ────────────────────────
  if (feature === 'marketplace' && rest[0] === 'listings' && rest[2] === 'favorite' && method === 'POST') {
    const authUser = requireAuth();
    if (!authUser) return true;
    const listingId = rest[1];

    // Toggle favorite
    const existing = await queryNeon(
      `SELECT id FROM listing_favorites WHERE user_id=$1 AND listing_id=$2`,
      [authUser.sub, listingId]
    );

    if (existing.length) {
      await queryNeon(
        `DELETE FROM listing_favorites WHERE user_id=$1 AND listing_id=$2`,
        [authUser.sub, listingId]
      );
      await queryNeon(
        `UPDATE listings SET favorites_count=GREATEST(0,favorites_count-1) WHERE id=$1`,
        [listingId]
      );
      return json({ success: true, favorited: false });
    } else {
      await queryNeon(
        `INSERT INTO listing_favorites (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [authUser.sub, listingId]
      );
      await queryNeon(
        `UPDATE listings SET favorites_count=favorites_count+1 WHERE id=$1`,
        [listingId]
      );
      return json({ success: true, favorited: true });
    }
  }

  // ── POST /api/v2/marketplace/listings/:id/report ──────────────────────────
  if (feature === 'marketplace' && rest[0] === 'listings' && rest[2] === 'report' && method === 'POST') {
    const authUser = requireAuth();
    if (!authUser) return true;
    const listingId = rest[1];
    const { reason, details } = body || {};

    if (!reason) return json({ success: false, error: 'reason required' }, 400);

    await queryNeon(
      `INSERT INTO listing_reports (listing_id, reporter_id, reason, details)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [listingId, authUser.sub, reason, details || null]
    );

    return json({ success: true, message: 'تم إرسال البلاغ' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES — يُستدعى من لوحة التحكم (ليس من التطبيق مباشرة)
  // Admin-Secret-Key header required
  // ══════════════════════════════════════════════════════════════════════════

  if (feature === 'admin') {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-secret-key'];
    // Allow both: ADMIN_SECRET_KEY env OR valid JWT with role=admin
    const jwtUser = getAuthUser();
    const isAdmin = (ADMIN_SECRET_KEY && adminKey === ADMIN_SECRET_KEY)
                 || (jwtUser && jwtUser.role === 'admin');

    if (!isAdmin) return json({ success: false, error: 'Forbidden' }, 403);

    // POST /api/v2/admin/listings/:id/approve
    if (rest[0] === 'listings' && rest[2] === 'approve' && method === 'POST') {
      const listingId = rest[1];

      await queryNeon(
        `UPDATE listings SET status='published', published_at=now(), updated_at=now()
         WHERE id=$1`,
        [listingId]
      );

      // جلب بيانات للإشعار
      const rows = await queryNeon(
        `SELECT l.title, l.user_id, u.display_name,
                d.fcm_token
         FROM listings l
         LEFT JOIN app_users u ON l.user_id=u.id
         LEFT JOIN LATERAL (
           SELECT fcm_token FROM user_devices
           WHERE user_id=l.user_id AND is_active=true
           ORDER BY last_seen_at DESC LIMIT 1
         ) d ON true
         WHERE l.id=$1`,
        [listingId]
      );

      if (rows.length && rows[0].fcm_token) {
        await sendFcmPush({
          fcmToken:      rows[0].fcm_token,
          title:         '✅ تم نشر إعلانك!',
          body:          `إعلانك "${rows[0].title}" تم الموافقة عليه ونُشر الآن`,
          data:          { listing_id: listingId, type: 'listing_approved' },
          serviceAccount: fcmServiceAccount,
          projectId:     fcmProjectId,
        });
      }

      // تسجيل الإشعار في جدول user_notifications
      if (rows.length) {
        await queryNeon(
          `INSERT INTO user_notifications (user_id, title, body, type, data)
           VALUES ($1,$2,$3,'listing_approved',$4)`,
          [
            rows[0].user_id,
            'تم نشر إعلانك!',
            `إعلانك "${rows[0].title}" تم الموافقة عليه ونُشر`,
            JSON.stringify({ listing_id: listingId }),
          ]
        );
      }

      return json({ success: true, message: 'تم نشر الإعلان وإرسال الإشعار للمستخدم' });
    }

    // POST /api/v2/admin/listings/:id/reject
    if (rest[0] === 'listings' && rest[2] === 'reject' && method === 'POST') {
      const listingId = rest[1];
      const { reason = 'لا يتوافق مع سياسة السوق' } = body || {};

      await queryNeon(
        `UPDATE listings SET status='rejected', rejection_reason=$2, updated_at=now()
         WHERE id=$1`,
        [listingId, reason]
      );

      const rows = await queryNeon(
        `SELECT l.title, l.user_id,
                d.fcm_token
         FROM listings l
         LEFT JOIN LATERAL (
           SELECT fcm_token FROM user_devices
           WHERE user_id=l.user_id AND is_active=true
           ORDER BY last_seen_at DESC LIMIT 1
         ) d ON true
         WHERE l.id=$1`,
        [listingId]
      );

      if (rows.length && rows[0].fcm_token) {
        await sendFcmPush({
          fcmToken:      rows[0].fcm_token,
          title:         '❌ لم يُوافق على إعلانك',
          body:          `السبب: ${reason}`,
          data:          { listing_id: listingId, type: 'listing_rejected' },
          serviceAccount: fcmServiceAccount,
          projectId:     fcmProjectId,
        });
      }

      if (rows.length) {
        await queryNeon(
          `INSERT INTO user_notifications (user_id, title, body, type, data)
           VALUES ($1,$2,$3,'listing_rejected',$4)`,
          [
            rows[0].user_id,
            'لم يُوافق على إعلانك',
            `السبب: ${reason}`,
            JSON.stringify({ listing_id: listingId, reason }),
          ]
        );
      }

      return json({ success: true, message: 'تم رفض الإعلان وإشعار المستخدم' });
    }

    // GET /api/v2/admin/listings — قائمة الإعلانات المعلّقة
    if (rest[0] === 'listings' && !rest[1] && method === 'GET') {
      const status = url.searchParams.get('status') || 'pending';
      const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit  = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
      const offset = (page - 1) * limit;

      const rows = await queryNeon(
        `SELECT l.id, l.title, l.listing_type, l.price, l.city, l.status,
                l.created_at, l.rejection_reason,
                u.display_name AS seller_name, u.email AS seller_email,
                mc.name_ar AS category_name
         FROM listings l
         LEFT JOIN app_users u ON l.user_id=u.id
         LEFT JOIN marketplace_categories mc ON l.category_id=mc.id
         WHERE l.status=$1
         ORDER BY l.created_at ASC
         LIMIT $2 OFFSET $3`,
        [status, limit, offset]
      );

      const count = await queryNeon(
        `SELECT COUNT(*) as total FROM listings WHERE status=$1`,
        [status]
      );

      return json({
        success: true,
        data: rows,
        pagination: { page, limit, total: parseInt(count[0]?.total || 0) },
      });
    }
  }

  return false; // route not matched
}
