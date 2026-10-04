import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

function getS3Client(config = {}) {
  const accountId = config.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const accessKeyId = config.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = config.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 credentials missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

const MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Uploads a buffer or base64 to Cloudflare R2
 * @param {Object} params
 * @param {Buffer|string} params.data - Buffer or base64 string
 * @param {string} [params.filename] - Original filename or hint
 * @param {string} [params.mimeType] - Mime type
 * @param {string} [params.folder] - Folder inside bucket (e.g. 'listings', 'avatars')
 * @param {string} [params.userId] - User ID for prefixing
 * @param {Object} [params.config] - Optional R2 config override
 */
export async function uploadToR2({
  data,
  filename,
  mimeType,
  folder = 'marketplace/listings',
  userId = 'anonymous',
  config = {},
}) {
  const bucketName = config.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'powerof';
  const publicUrlBase = (config.R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

  let buffer;
  let resolvedMime = mimeType;

  if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (typeof data === 'string') {
    // Check if data URI
    const match = data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (match) {
      resolvedMime = resolvedMime || match[1];
      buffer = Buffer.from(match[2], 'base64');
    } else {
      buffer = Buffer.from(data, 'base64');
    }
  } else {
    throw new Error('Invalid data format for upload');
  }

  // Max 10MB per image
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('Image size exceeds 10MB limit');
  }

  // Determine extension
  let ext = 'jpg';
  if (filename && filename.includes('.')) {
    const rawExt = filename.split('.').pop().toLowerCase();
    if (MIME_MAP[rawExt]) {
      ext = rawExt;
      resolvedMime = resolvedMime || MIME_MAP[rawExt];
    }
  } else if (resolvedMime && EXT_MAP[resolvedMime]) {
    ext = EXT_MAP[resolvedMime];
  }

  resolvedMime = resolvedMime || MIME_MAP[ext] || 'image/jpeg';

  const datePrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${folder}/${datePrefix}/${userId}_${randomUUID().slice(0, 8)}.${ext}`;

  const s3 = getS3Client(config);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: resolvedMime,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await s3.send(command);

  return {
    key,
    url: `${publicUrlBase}/${key}`,
    size: buffer.length,
    mimeType: resolvedMime,
  };
}

/**
 * Deletes an object from Cloudflare R2 by key or public URL
 * @param {string} keyOrUrl - Object key or full public URL
 * @param {Object} [config] - Optional config override
 */
export async function deleteFromR2(keyOrUrl, config = {}) {
  if (!keyOrUrl) return false;
  try {
    const bucketName = config.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'powerof';
    const publicUrlBase = (config.R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

    let key = String(keyOrUrl).trim();
    if (key.startsWith('http://') || key.startsWith('https://')) {
      key = key.replace(publicUrlBase, '').replace(/^\/+/, '');
      if (key.startsWith('http')) {
        try {
          const u = new URL(keyOrUrl);
          key = u.pathname.replace(/^\/+/, '');
        } catch (_) {}
      }
    }

    if (!key) return false;

    const s3 = getS3Client(config);
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3.send(command);
    return true;
  } catch (err) {
    console.warn('R2 delete error for key:', keyOrUrl, err.message);
    return false;
  }
}
