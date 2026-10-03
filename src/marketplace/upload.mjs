/**
 * src/marketplace/upload.mjs
 * رفع الصور إلى Cloudflare R2
 */
import { uploadToR2 } from '../lib/r2.mjs';

export async function handleUploadRoutes({
  pathname,
  method,
  body,
  json,
  config,
  authUser,
}) {
  const segments = pathname.replace(/^\//, '').split('/');
  // segments: ['api', 'v2', 'upload'] or ['api', 'v2', 'marketplace', 'upload']
  const [, , feature, sub] = segments;

  const isUploadPath = feature === 'upload' || (feature === 'marketplace' && sub === 'upload');
  if (!isUploadPath || method !== 'POST') return false;

  if (!authUser) return json({ success: false, error: 'Unauthorized' }, 401);

  try {
    const {
      image,
      filename,
      mime_type,
      mimeType,
      folder = 'marketplace/listings',
      images,
    } = body || {};

    // Batch upload (up to 5 images)
    if (Array.isArray(images) && images.length > 0) {
      if (images.length > 5) {
        return json({ success: false, error: 'Maximum 5 images allowed per batch upload' }, 400);
      }

      const uploaded = await Promise.all(
        images.map((item, idx) =>
          uploadToR2({
            data: item.image || item.data,
            filename: item.filename || `photo_${idx}.jpg`,
            mimeType: item.mime_type || item.mimeType,
            folder: item.folder || folder,
            userId: authUser.sub,
            config,
          })
        )
      );

      return json({
        success: true,
        data: {
          images: uploaded,
        },
      });
    }

    if (!image) {
      return json({ success: false, error: 'image base64 data required' }, 400);
    }

    const result = await uploadToR2({
      data: image,
      filename,
      mimeType: mime_type || mimeType,
      folder,
      userId: authUser.sub,
      config,
    });

    return json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('R2 upload error:', err);
    return json({ success: false, error: err.message || 'Image upload failed' }, 500);
  }
}
