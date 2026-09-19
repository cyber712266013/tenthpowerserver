import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { companyRouter } from './routes/company.js';
import { servicesRouter } from './routes/services.js';
import { projectsRouter } from './routes/projects.js';
import { galleryRouter } from './routes/gallery.js';
import { adsRouter } from './routes/ads.js';
import { contactRouter } from './routes/contact.js';
import { pushRouter } from './routes/push.js';
import { chatRouter } from './routes/chat.js';

export const app = new Hono();

// Global Middlewares
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })
);

// Health Check
app.get('/', (c) => {
  return c.json({
    status: 'online',
    service: 'Tenth Power Edge API Gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API v1 Routes
app.route('/api/v1/company', companyRouter);
app.route('/api/v1/services', servicesRouter);
app.route('/api/v1/projects', projectsRouter);
app.route('/api/v1/gallery', galleryRouter);
app.route('/api/v1/ads', adsRouter);
app.route('/api/v1/contact', contactRouter);
app.route('/api/v1/push', pushRouter);
app.route('/api/v1/chat', chatRouter);

export default app;
