// ═══════════════════════════════════════════════════════════════
//  GRACE CHURCH MEDIA — Server Entry Point
//  Every request, connection event, and action is logged to
//  stdout so Render.com shows full live activity.
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

// ─── Print all env keys on startup (values hidden for security) ─
logger.startup('='.repeat(60));
logger.startup('Grace Church Media API — booting...');
logger.startup(`NODE_ENV  : ${process.env.NODE_ENV}`);
logger.startup(`PORT      : ${PORT}`);
logger.startup(`DB_HOST   : ${process.env.DB_HOST}`);
logger.startup(`DB_PORT   : ${process.env.DB_PORT}`);
logger.startup(`DB_NAME   : ${process.env.DB_NAME}`);
logger.startup(`DB_USER   : ${process.env.DB_USER}`);
logger.startup(`DB_SSL    : ${process.env.DB_SSL}`);
logger.startup(`JWT set   : ${!!process.env.JWT_SECRET}`);
logger.startup(`TELEGRAM  : ${!!process.env.TELEGRAM_BOT_TOKEN}`);
logger.startup(`YOUTUBE   : ${!!process.env.YOUTUBE_CLIENT_ID}`);
logger.startup('='.repeat(60));

// ─── Security ─────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests — try again later.' },
});
app.use('/api/', limiter);

// ─── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── VERBOSE REQUEST LOGGER ────────────────────────────────────
// Logs every single incoming request to Render logs
app.use((req, res, next) => {
  const start = Date.now();

  // Log when the request comes in
  logger.info(`INCOMING  | ${req.method} ${req.originalUrl} | ip:${req.ip} | body:${JSON.stringify(req.body || {}).substring(0, 120)}`);

  // Log when the response goes out
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const who = req.user ? `${req.user.email}(${req.user.role})` : 'guest';
    logger.request(req.method, req.originalUrl, res.statusCode, ms, who);
  });

  next();
});

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
  logger.info('Health check requested');
  let dbStatus = 'unknown';
  try {
    await db.promise().query('SELECT 1');
    dbStatus = 'connected';
    logger.info('Health check — DB ping successful');
  } catch (e) {
    dbStatus = 'error: ' + e.message;
    logger.error('Health check — DB ping failed', e.message);
  }
  res.json({
    success:     true,
    message:     '🙏 Grace Church Media API is alive',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database:    dbStatus,
    database_name: process.env.DB_NAME,
  });
});

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/media',   mediaRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin',   adminRoutes);

// ─── 404 ──────────────────────────────────────────────────────
app.use('*', (req, res) => {
  logger.warn(`404 — Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── Error Handler ────────────────────────────────────────────
app.use(errorHandler);

// ─── Background Cron — retry failed uploads every 2 min ───────
cron.schedule('*/2 * * * *', async () => {
  logger.info('CRON | Checking for failed uploads to retry...');
  try {
    const uploadController = require('./controllers/upload_controller');
    await uploadController.retryFailedUploads();
  } catch (err) {
    logger.error('CRON | retryFailedUploads error:', err.message);
  }
});

// ─── Start Server ─────────────────────────────────────────────
logger.startup('Testing database connection...');

db.getConnection((err, conn) => {
  if (err) {
    logger.error('DATABASE CONNECTION FAILED');
    logger.error('Error code    :', err.code);
    logger.error('Error message :', err.message);
    logger.error('Attempted host:', process.env.DB_HOST);
    logger.error('Attempted port:', process.env.DB_PORT);
    logger.error('Attempted db  :', process.env.DB_NAME);
    logger.error('Attempted user:', process.env.DB_USER);
    logger.error('→ Check your Render env vars — DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD');
    process.exit(1);
  }

  logger.startup(`✅ Database connected! Thread ID: ${conn.threadId}`);
  logger.startup(`✅ Connected to database: ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT}`);
  conn.release();

  // Verify the users table exists
  db.promise().query('SELECT COUNT(*) AS user_count FROM users')
    .then(([rows]) => {
      logger.startup(`✅ users table found — ${rows[0].user_count} user(s) in database`);
    })
    .catch((e) => {
      logger.error('users table check failed:', e.message);
      logger.error('→ The database exists but the tables may not be set up yet.');
      logger.error('→ Run the schema.sql file against your defaultdb database.');
    });

  app.listen(PORT, () => {
    logger.startup('='.repeat(60));
    logger.startup(`🚀 Server running on port ${PORT}`);
    logger.startup(`🌍 Environment : ${process.env.NODE_ENV}`);
    logger.startup(`🗄  Database    : ${process.env.DB_NAME}`);
    logger.startup(`🔗 Health URL  : https://sharegrace-church-api.onrender.com/health`);
    logger.startup('='.repeat(60));
    logger.info('Server ready — waiting for requests...');
  });
});

module.exports = app;
