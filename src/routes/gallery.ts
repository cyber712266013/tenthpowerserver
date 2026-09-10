import { Hono } from 'hono';
import { queryNeon } from '../db/neon.js';

export const galleryRouter = new Hono();

galleryRouter.get('/', async (c) => {
  try {
    const rows = await queryNeon(
      `SELECT id, file_name, file_url, cdn_url, title_ar, category 
       FROM media_library 
       WHERE is_public = true 
       ORDER BY created_at DESC`
    );

    return c.json({
      success: true,
      data: rows.map((g) => ({
        id: g.id,
        title_ar: g.title_ar?.trim() || '',
        category_ar: g.category?.trim() || '',
        image_url: g.cdn_url || g.file_url || '',
      })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
