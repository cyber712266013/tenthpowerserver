/**
 * src/marketplace/auth.mjs
 * تسجيل الدخول بـ Google، إدارة أجهزة المستخدمين (FCM)، والمصادقة
 */
import { signJwt } from './jwt.mjs';

export async function verifyGoogleToken(idToken) {
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

export async function handleAuthRoutes({
  pathname,
  method,
  body,
  json,
  queryNeon,
  config,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'auth', ...rest]
  const [, , , action] = segments;

  // ── POST /api/v2/auth/google ────────────────────────────────────────────────
  if (action === 'google' && method === 'POST') {
    const { id_token } = body || {};
    if (!id_token) return json({ success: false, error: 'id_token required' }, 400);

    try {
      const google = await verifyGoogleToken(id_token);

      // Upsert user with all columns
      const rows = await queryNeon(
        `INSERT INTO app_users (google_id, email, display_name, avatar_url, last_login_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (google_id) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = COALESCE(app_users.display_name, EXCLUDED.display_name),
           avatar_url = COALESCE(app_users.avatar_url, EXCLUDED.avatar_url),
           last_login_at = now(),
           updated_at = now()
          RETURNING id, google_id, email, display_name, avatar_url, phone, bio, city, social_links, role, is_verified, is_active, is_banned, created_at`,
        [google.google_id, google.email, google.name, google.picture]
      );

      const user = rows[0];
      if (user.is_banned) {
        return json({ success: false, error: 'account_banned', message: 'تم حظر هذا الحساب لمخالفة سياسة الاستخدام' }, 403);
      }
      if (!user.is_active) {
        return json({ success: false, error: 'account_inactive', message: 'هذا الحساب غير نشط حالياً' }, 403);
      }

      const token = signJwt(
        { sub: user.id, email: user.email, role: user.role },
        config.JWT_SECRET
      );

      return json({
        success: true,
        data: {
          token,
          user: {
            id:           user.id,
            google_id:    user.google_id,
            email:        user.email,
            display_name: user.display_name || google.name,
            avatar_url:   user.avatar_url || google.picture,
            phone:        user.phone,
            bio:          user.bio,
            city:         user.city,
            social_links: user.social_links || {},
            role:         user.role,
            is_verified:  Boolean(user.is_verified),
            is_active:    user.is_active,
            created_at:   user.created_at,
          },
        },
      });
    } catch (err) {
      return json({ success: false, error: err.message }, 401);
    }
  }

  // ── POST /api/v2/auth/device — تسجيل أو تحديث رمز جهاز الـ FCM ──────────────
  if (action === 'device' && method === 'POST') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const { fcm_token, platform = 'android', device_model } = body || {};
    if (!fcm_token) return json({ success: false, error: 'fcm_token required' }, 400);

    await queryNeon(
      `INSERT INTO user_devices (user_id, fcm_token, platform, device_model, is_active, last_seen_at)
       VALUES ($1, $2, $3, $4, true, now())
       ON CONFLICT (user_id, fcm_token) DO UPDATE SET
         is_active = true,
         platform = EXCLUDED.platform,
         device_model = COALESCE(EXCLUDED.device_model, user_devices.device_model),
         last_seen_at = now()`,
      [authUser.sub, fcm_token, platform, device_model]
    );

    return json({ success: true, message: 'Device registered successfully' });
  }

  // ── DELETE /api/v2/auth/device — إلغاء تسجيل رمز الجهاز عند تسجيل الخروج ──────
  if (action === 'device' && method === 'DELETE') {
    if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

    const { fcm_token } = body || {};
    if (fcm_token) {
      await queryNeon(
        `UPDATE user_devices SET is_active = false, last_seen_at = now()
         WHERE user_id = $1 AND fcm_token = $2`,
        [authUser.sub, fcm_token]
      );
    } else {
      await queryNeon(
        `UPDATE user_devices SET is_active = false, last_seen_at = now()
         WHERE user_id = $1`,
        [authUser.sub]
      );
    }

    return json({ success: true, message: 'Device unregistered successfully' });
  }

  return false;
}
