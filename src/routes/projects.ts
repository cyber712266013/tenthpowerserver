import { Hono } from 'hono';
import { queryNeon, executeNeon } from '../db/neon.js';

export const projectsRouter = new Hono();

const DEFAULT_PROJECTS = [
  {
    id: 'proj-1',
    title_ar: 'مشروع واجهات برج المركز المالي بالرياض',
    slug: 'riyadh-financial-tower',
    description_ar:
      'تصميم وتنفيذ واجهات زجاجية هيكلية عملاقة مع هياكل ستانلس ستيل داعمة ونوافذ ألمنيوم عازلة للصوت والحرارة بأعلى معايير الكفاءة المعمارية لبرج المركز المالي بمدينة الرياض.',
    category_ar: 'واجهات زجاجية وكلادينج',
    client_name: 'شركة الاستثمار العقاري الحديث',
    location_ar: 'طريق الملك فهد - الرياض',
    cover_image_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
    gallery_images: [
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1541888946425-d0fbb18086f6?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
    ],
    is_featured: true,
  },
  {
    id: 'proj-2',
    title_ar: 'واجهات معارض الماركات العالمية (Spider Glass)',
    slug: 'global-brands-showrooms',
    description_ar:
      'تنفيذ واجهات زجاج سيكوريت متكاملة بدون فواصل معدنية (Spider System) لمجموعة معارض تجارية كبرى بمدينة الرياض لضمان رؤية بانورامية كاملة للمنتجات مع أبواب سحاب ذكية.',
    category_ar: 'واجهات معارض ومحلات',
    client_name: 'مجموعة المجمعات التجارية الفاخرة',
    location_ar: 'حي العليا - الرياض',
    cover_image_url: 'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80',
    gallery_images: [
      'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
    ],
    is_featured: true,
  },
  {
    id: 'proj-3',
    title_ar: 'قواطع زجاجية ومكاتب ذكية لشركة تقنية',
    slug: 'tech-company-partitions',
    description_ar:
      'تقسيم مكاتب الإدارة والموظفين للشركة باستخدام قواطع زجاجية مثلجة جزئياً مع درابزينات سلالم مدمجة بالستانلس ستيل المطلي باللون الذهبي الفاخر وعوازل صوتية متطورة.',
    category_ar: 'قواطع وديكورات داخلية',
    client_name: 'شركة الحلول السحابية المتقدمة',
    location_ar: 'واحة الأعمال - الرياض',
    cover_image_url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
    gallery_images: [
      'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
    ],
    is_featured: true,
  },
  {
    id: 'proj-4',
    title_ar: 'مجمع فلل سكنية فاخرة - حي النرجس',
    slug: 'narjis-luxury-villas',
    description_ar:
      'تجهيز كامل لمجموعة فلل سكنية بنوافذ ألمنيوم سحاب دبل جلاس عازل حراري، درابزينات شرفات زجاجية مودرن، وكبائن شورات سيكوريت مخصصة لكل جناح نوم بدقة متناهية.',
    category_ar: 'ألمنيوم وزجاج سكني',
    client_name: 'شركة الإسكان الراقي للتطوير',
    location_ar: 'حي النرجس - الرياض',
    cover_image_url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
    gallery_images: [
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
    ],
    is_featured: true,
  },
  {
    id: 'proj-5',
    title_ar: 'مجمع النخيل التجاري - الدمام',
    slug: 'nakheel-commercial-dammam',
    description_ar:
      'واجهات زجاجية ونظام سبايدر للمعارض والمطاعم مع أبواب أوتوماتيكية إيطالية الصنع. تم تنفيذ المشروع بأعلى درجات الدقة الهندسية والعزل الحراري ومقاومة العوامل الجوية.',
    category_ar: 'واجهات تجارية',
    client_name: 'مجموعة النخيل للاستثمار',
    location_ar: 'الدمام',
    cover_image_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
    gallery_images: [
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1541888946425-d0fbb18086f6?auto=format&fit=crop&w=1200&q=80',
    ],
    is_featured: true,
  },
];

projectsRouter.get('/', async (c) => {
  try {
    const rows = await queryNeon(
      `SELECT * FROM projects 
       WHERE is_active = true 
       ORDER BY is_featured DESC, display_order ASC, created_at DESC`
    );

    if (rows && rows.length > 0) {
      return c.json({
        success: true,
        data: rows.map((p) => {
          const gallery = (p.gallery_urls as string[]) || (p.gallery_images as string[]) || [];
          const cover = p.cover_image_url || p.cover_url || p.image_url || (gallery.length > 0 ? gallery[0] : 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80');
          return {
            id: p.id,
            title_ar: p.title_ar,
            slug: p.slug,
            description_ar: p.description_ar || '',
            category_ar: p.category_ar || p.city || 'واجهات ومباني',
            client_name: p.client_name_ar || p.client_name || 'عميل مميز',
            location_ar: p.location_ar || p.city || 'المملكة العربية السعودية',
            cover_image_url: cover,
            gallery_images: gallery.length > 0 ? gallery : [cover],
            is_featured: p.is_featured ?? false,
          };
        }),
      });
    }

    return c.json({
      success: true,
      data: DEFAULT_PROJECTS,
    });
  } catch (err: any) {
    return c.json({ success: true, data: DEFAULT_PROJECTS });
  }
});

projectsRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const rows = await queryNeon(
      `SELECT * FROM projects 
       WHERE (id::text = $1 OR slug = $1) AND is_active = true 
       LIMIT 1`,
      [id]
    );

    if (rows.length > 0) {
      const p = rows[0];

      // Increment view count in background
      executeNeon(
        `UPDATE projects SET view_count = COALESCE(view_count, 0) + 1 WHERE id::text = $1 OR slug = $1`,
        [id]
      );

      const gallery = (p.gallery_urls as string[]) || (p.gallery_images as string[]) || [];
      const cover = p.cover_image_url || p.cover_url || p.image_url || (gallery.length > 0 ? gallery[0] : 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80');

      return c.json({
        success: true,
        data: {
          id: p.id,
          title_ar: p.title_ar,
          slug: p.slug,
          description_ar: p.description_ar || '',
          category_ar: p.category_ar || p.city || 'واجهات ومباني',
          client_name: p.client_name_ar || p.client_name || 'عميل مميز',
          location_ar: p.location_ar || p.city || 'المملكة العربية السعودية',
          cover_image_url: cover,
          gallery_images: gallery.length > 0 ? gallery : [cover],
          is_featured: p.is_featured ?? false,
        },
      });
    }

    const defaultProj = DEFAULT_PROJECTS.find((p) => p.id === id || p.slug === id) || DEFAULT_PROJECTS[0];
    return c.json({
      success: true,
      data: defaultProj,
    });
  } catch (err: any) {
    const defaultProj = DEFAULT_PROJECTS[0];
    return c.json({ success: true, data: defaultProj });
  }
});
