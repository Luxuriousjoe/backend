require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const db = require('./config/db_config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/error_handler');

// Routes
const authRoutes = require('./routes/auth_routes');
const mediaRoutes = require('./routes/media_routes');
const uploadRoutes = require('./routes/upload_routes');
const adminRoutes = require('./routes/admin_routes');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Request Parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Church Media API is alive 🙏',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', adminRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Background Upload Cron Job ───────────────────────────────────────────────
// Runs every 2 minutes — retries failed uploads
cron.schedule('*/2 * * * *', async () => {
  try {
    const uploadController = require('./controllers/upload_controller');
    await uploadController.retryFailedUploads();
  } catch (err) {
    logger.error('Cron job error:', err.message);
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
db.getConnection((err, conn) => {
  if (err) {
    logger.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  conn.release();
  logger.info('✅ Database connected successfully');

  app.listen(PORT, () => {
    logger.info(`🚀 Church Media Server running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
  });
});

module.exports = app;
