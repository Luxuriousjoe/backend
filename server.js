// ═══════════════════════════════════════════════════════════════
//  GRACE CHURCH MEDIA — Server
//  Full logging. YouTube channel video cache refreshed every 30min
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const cron       = require('node-cron');

const db          = require('./config/db_config');
const logger      = require('./utils/logger');
const errorHandler = require('./middleware/error_handler');

// ─── Routes ───────────────────────────────────────────────────
const authRoutes   = require('./routes/auth_routes');
const mediaRoutes  = require('./routes/media_routes');
const uploadRoutes = require('./routes/upload_routes');
const adminRoutes  = require('./routes/admin_routes');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Startup banner ───────────────────────────────────────────
logger.startup('='.repeat(60));
logger.startup('Grace Church Media API — booting...');
logger.startup(`NODE_ENV  : ${process.env.NODE_ENV}`);
logger.startup(`PORT      : ${PORT}`);
logger.startup(`DB_HOST   : ${process.env.DB_HOST}`);
logger.startup(`DB_PORT   : ${process.env.DB_PORT}`);
logger.startup(`DB_NAME   : ${process.env.DB_NAME}`);
logger.startup(`JWT set   : ${!!process.env.JWT_SECRET}`);
logger.startup(`TELEGRAM  : ${!!process.env.TELEGRAM_BOT_TOKEN}`);
logger.startup(`YOUTUBE   : ${!!process.env.YOUTUBE_CLIENT_ID}`);
logger.startup('='.repeat(60));

// ─── Middleware ───────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()),
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300,
  message: { success: false, message: 'Too many requests — try again later.' } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request logger (every request shows in Render logs) ─────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const who = req.user ? `${req.user.email}` : 'guest';
    const icon = res.statusCode < 300 ? '→' : res.statusCode < 400 ? '↪' : '✗';
    logger.info(`${icon} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ${who}`);
  });
  next();
});

// ─── Health check ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbOk = false;
  try { await db.promise().query('SELECT 1'); dbOk = true; } catch (_) {}
  res.json({ success: true, message: '🙏 Grace Church API is alive', db: dbOk ? 'connected' : 'error', ts: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/media',   mediaRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin',   adminRoutes);

// ─── 404 ──────────────────────────────────────────────────────
app.use('*', (req, res) => {
  logger.warn(`404 | ${req.method} ${req.originalUrl}`);
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});
app.use(errorHandler);

// ─── Cron: Retry failed uploads every 2 minutes ───────────────
cron.schedule('*/2 * * * *', async () => {
  try {
    const uc = require('./controllers/upload_controller');
    await uc.retryFailedUploads();
  } catch (e) { logger.error('CRON retry error:', e.message); }
});

// ─── Cron: Refresh YouTube channel videos every 30 minutes ───
cron.schedule('*/30 * * * *', async () => {
  logger.info('CRON | Refreshing YouTube channel video cache...');
  try {
    const yt = require('./services/youtube_service');
    await yt.fetchChannelVideos();
  } catch (e) { logger.error('CRON YT cache error:', e.message); }
});

// ─── Start server ─────────────────────────────────────────────
logger.startup('Connecting to database...');
db.getConnection((err, conn) => {
  if (err) {
    logger.error('DATABASE CONNECTION FAILED');
    logger.error(`Code: ${err.code} | Message: ${err.message}`);
    logger.error(`Host: ${process.env.DB_HOST}:${process.env.DB_PORT} DB: ${process.env.DB_NAME}`);
    process.exit(1);
  }
  logger.startup(`✅ Database connected — thread ID: ${conn.threadId}`);
  logger.startup(`✅ Using database: ${process.env.DB_NAME}`);
  conn.release();

  // Check users table exists
  db.promise().query('SELECT COUNT(*) AS cnt FROM users')
    .then(([r]) => logger.startup(`✅ users table OK — ${r[0].cnt} user(s)`))
    .catch(e  => logger.error(`users table check failed: ${e.message}`));

  app.listen(PORT, () => {
    logger.startup('='.repeat(60));
    logger.startup(`🚀 Server live on port ${PORT}`);
    logger.startup(`🗄  Database   : ${process.env.DB_NAME}`);
    logger.startup(`🔗 Health URL  : /health`);
    logger.startup('='.repeat(60));
  });

  // Warm up YouTube cache on first boot (after 5 seconds)
  setTimeout(async () => {
    try {
      const yt = require('./services/youtube_service');
      await yt.fetchChannelVideos();
      logger.startup('✅ YouTube channel video cache warmed up');
    } catch (e) {
      logger.warn(`YouTube cache warmup skipped: ${e.message}`);
    }
  }, 5000);
});

module.exports = app;
