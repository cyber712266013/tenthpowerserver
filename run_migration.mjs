/**
 * run_migration.mjs
 * تشغيل migration الـ Marketplace على Neon PostgreSQL
 * Usage: node run_migration.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const idx = t.indexOf('=');
  if (idx > 0) {
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    process.env[k] = v;
  }
}

const NEON_CONN = process.env.NEON_DATABASE_URL;
const match = NEON_CONN.match(/@([^/]+)\//);
const host = match ? match[1] : '';
const endpoint = `https://${host}/sql`;

async function run(sql, params = []) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': NEON_CONN,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.rows || [];
}

console.log('\n🚀 Running Marketplace Migration on Neon...\n');

// ─── 1. uuid extension ──────────────────────────────────────────────────────
try {
  await run(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  console.log('✅ uuid-ossp extension ready');
} catch (e) { console.log('⚠️  uuid-ossp:', e.message); }

// ─── 2. app_users ────────────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_id       TEXT UNIQUE,
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    phone           TEXT,
    bio             TEXT,
    city            TEXT,
    social_links    JSONB DEFAULT '{}',
    role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'moderator', 'admin')),
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_banned       BOOLEAN NOT NULL DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
console.log('✅ app_users table ready');

await run(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false`);
console.log('✅ is_verified column ensured on app_users');

await run(`CREATE INDEX IF NOT EXISTS idx_app_users_email  ON app_users(email)`);
await run(`CREATE INDEX IF NOT EXISTS idx_app_users_google ON app_users(google_id)`);

// ─── 3. user_devices ────────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS user_devices (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    fcm_token     TEXT NOT NULL,
    platform      TEXT CHECK (platform IN ('android', 'ios', 'web')),
    device_model  TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, fcm_token)
  )
`);
console.log('✅ user_devices table ready');

// ─── 4. marketplace_categories ───────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS marketplace_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_ar     TEXT NOT NULL,
    icon        TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
console.log('✅ marketplace_categories table ready');

// Seed categories (فقط إذا فارغة)
const existing = await run(`SELECT COUNT(*) as c FROM marketplace_categories`);
if (parseInt(existing[0].c) === 0) {
  await run(`
    INSERT INTO marketplace_categories (name_ar, icon, sort_order) VALUES
      ('زجاج وسيكوريت',    '🪟', 1),
      ('ألمنيوم وواجهات',  '🏗️', 2),
      ('أبواب ونوافذ',     '🚪', 3),
      ('معدات وأدوات',     '🔧', 4),
      ('مواد بناء',        '🧱', 5),
      ('سيارات',           '🚗', 6),
      ('أثاث ومفروشات',   '🛋️', 7),
      ('إلكترونيات',       '📱', 8),
      ('أخرى',             '📦', 9)
  `);
  console.log('✅ Categories seeded (9 categories)');
} else {
  console.log(`ℹ️  Categories already seeded (${existing[0].c} rows)`);
}

// ─── 5. listings ─────────────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS listings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    category_id      UUID REFERENCES marketplace_categories(id) ON DELETE SET NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    price            DECIMAL(12, 2),
    price_negotiable BOOLEAN NOT NULL DEFAULT false,
    currency         TEXT NOT NULL DEFAULT 'SAR',
    listing_type     TEXT NOT NULL DEFAULT 'sale'
                     CHECK (listing_type IN ('sale', 'wanted')),
    condition        TEXT CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'for_parts')),
    city             TEXT,
    location_lat     DOUBLE PRECISION,
    location_lng     DOUBLE PRECISION,
    show_phone       BOOLEAN NOT NULL DEFAULT true,
    show_whatsapp    BOOLEAN NOT NULL DEFAULT true,
    show_telegram    BOOLEAN NOT NULL DEFAULT false,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('draft','pending','published','rejected','sold','closed','expired','deleted')),
    rejection_reason TEXT,
    views_count      INTEGER NOT NULL DEFAULT 0,
    favorites_count  INTEGER NOT NULL DEFAULT 0,
    is_featured      BOOLEAN NOT NULL DEFAULT false,
    plan_type        TEXT NOT NULL DEFAULT 'free'
                     CHECK (plan_type IN ('free', 'featured', 'premium')),
    published_at     TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
console.log('✅ listings table ready');

await run(`CREATE INDEX IF NOT EXISTS idx_listings_status   ON listings(status)`);
await run(`CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category_id)`);
await run(`CREATE INDEX IF NOT EXISTS idx_listings_user     ON listings(user_id)`);
await run(`CREATE INDEX IF NOT EXISTS idx_listings_feed     ON listings(published_at DESC) WHERE status='published'`);

// ─── 6. listing_images ───────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS listing_images (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    image_url   TEXT NOT NULL,
    storage_key TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_cover    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
console.log('✅ listing_images table ready');

// ─── 7. listing_favorites ────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS listing_favorites (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, listing_id)
  )
`);
console.log('✅ listing_favorites table ready');

// ─── 8. listing_reports ──────────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS listing_reports (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL CHECK (reason IN ('spam','fraud','inappropriate','duplicate','wrong_category','other')),
    details     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(listing_id, reporter_id)
  )
`);
console.log('✅ listing_reports table ready');

// ─── 9. user_notifications ───────────────────────────────────────────────────
await run(`
  CREATE TABLE IF NOT EXISTS user_notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    type        TEXT NOT NULL,
    data        JSONB DEFAULT '{}',
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
console.log('✅ user_notifications table ready');

console.log('\n🎉 Migration completed successfully!\n');
console.log('التالي: شغّل node server.mjs وجرّب http://localhost:8787/api/v2/marketplace/categories\n');
