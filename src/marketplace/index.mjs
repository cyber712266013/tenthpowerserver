/**
 * src/marketplace/index.mjs
 * الموجه الرئيسي لجميع خدمات ووحدات السوق والإشعارات والمستخدمين (Marketplace Router)
 */
import { extractAuthUser } from './jwt.mjs';
import { handleAuthRoutes } from './auth.mjs';
import { handleUserRoutes } from './user.mjs';
import { handleCategoryRoutes } from './categories.mjs';
import { handleListingRoutes } from './listings.mjs';
import { handleFavoriteRoutes } from './favorites.mjs';
import { handleReportRoutes } from './reports.mjs';
import { handleNotificationRoutes } from './notifications.mjs';
import { handleUploadRoutes } from './upload.mjs';
import { handleAdminRoutes } from './admin.mjs';

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
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', feature, ...]
  const [, version, feature] = segments;

  if (version !== 'v2') return false;

  const authUser = extractAuthUser(req, config.JWT_SECRET);

  // 1. Auth routes (/api/v2/auth/...)
  if (feature === 'auth') {
    const matched = await handleAuthRoutes({
      pathname,
      method,
      body,
      json,
      queryNeon,
      config,
      authUser,
    });
    if (matched !== false) return true;
  }

  // 2. User & Profile routes (/api/v2/me, /api/v2/users/:id)
  if (feature === 'me' || feature === 'users') {
    const matched = await handleUserRoutes({
      pathname,
      method,
      url,
      body,
      json,
      queryNeon,
      authUser,
    });
    if (matched !== false) return true;
  }

  // 3. Upload routes (/api/v2/upload, /api/v2/marketplace/upload)
  if (feature === 'upload' || (feature === 'marketplace' && segments[3] === 'upload')) {
    const matched = await handleUploadRoutes({
      pathname,
      method,
      body,
      json,
      config,
      authUser,
    });
    if (matched !== false) return true;
  }

  // 4. Notifications routes (/api/v2/notifications/...)
  if (feature === 'notifications') {
    const matched = await handleNotificationRoutes({
      pathname,
      method,
      url,
      json,
      queryNeon,
      authUser,
    });
    if (matched !== false) return true;
  }

  // 5. Admin routes (/api/v2/admin/...)
  if (feature === 'admin') {
    const matched = await handleAdminRoutes({
      pathname,
      method,
      url,
      body,
      req,
      json,
      queryNeon,
      config,
      authUser,
    });
    if (matched !== false) return true;
  }

  // 6. Marketplace routes (/api/v2/marketplace/...)
  if (feature === 'marketplace') {
    // 6.1 Categories
    if (segments[3] === 'categories') {
      const matched = await handleCategoryRoutes({
        pathname,
        method,
        json,
        queryNeon,
      });
      if (matched !== false) return true;
    }

    // 6.2 Favorites
    if (segments[3] === 'listings' && segments[5] === 'favorite') {
      const matched = await handleFavoriteRoutes({
        pathname,
        method,
        json,
        queryNeon,
        authUser,
      });
      if (matched !== false) return true;
    }

    // 6.3 Reports
    if (segments[3] === 'listings' && segments[5] === 'report') {
      const matched = await handleReportRoutes({
        pathname,
        method,
        body,
        json,
        queryNeon,
        authUser,
      });
      if (matched !== false) return true;
    }

    // 6.4 Listings (Feed, Details, Create, Edit, Status, Renew, Delete)
    if (segments[3] === 'listings') {
      const matched = await handleListingRoutes({
        pathname,
        method,
        url,
        body,
        json,
        queryNeon,
        authUser,
        notifyTelegramAdmins,
      });
      if (matched !== false) return true;
    }
  }

  return false;
}
