const bcrypt = require('bcryptjs');
const db = require('../config/db_config');

// ─── Get All Users ────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Create Admin User ────────────────────────────────────────────────────────
exports.createAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.promise().query(
      'INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, "admin", ?)',
      [name, email.toLowerCase(), hash]
    );

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['ADMIN_CREATED', req.user.id, `Admin created: ${email}`]
    );

    res.status(201).json({ success: true, message: 'Admin created', data: { id: result.insertId } });
  } catch (err) {
    next(err);
  }
};

// ─── Create Regular User ──────────────────────────────────────────────────────
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.promise().query(
      'INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, "user", ?)',
      [name, email.toLowerCase(), hash]
    );

    res.status(201).json({ success: true, message: 'User created', data: { id: result.insertId } });
  } catch (err) {
    next(err);
  }
};

// ─── Toggle User Active Status ────────────────────────────────────────────────
exports.toggleUser = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });

    const newStatus = !rows[0].is_active;
    await db.promise().query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);

    res.json({ success: true, message: `User ${newStatus ? 'activated' : 'deactivated'}` });
  } catch (err) {
    next(err);
  }
};

// ─── Get Logs ─────────────────────────────────────────────────────────────────
exports.getLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows] = await db.promise().query(
      `SELECT l.*, u.name AS user_name, u.email AS user_email
       FROM logs l
       LEFT JOIN users u ON l.user_id = u.id
       ORDER BY l.timestamp DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [[{ total_media }]] = await db.promise().query('SELECT COUNT(*) AS total_media FROM media');
    const [[{ uploaded }]] = await db.promise().query('SELECT COUNT(*) AS uploaded FROM media WHERE status = "uploaded"');
    const [[{ pending }]] = await db.promise().query('SELECT COUNT(*) AS pending FROM media WHERE status IN ("pending", "uploading")');
    const [[{ failed }]] = await db.promise().query('SELECT COUNT(*) AS failed FROM media WHERE status = "failed"');
    const [[{ total_users }]] = await db.promise().query('SELECT COUNT(*) AS total_users FROM users');
    const [[{ videos }]] = await db.promise().query('SELECT COUNT(*) AS videos FROM media WHERE type = "video" AND status = "uploaded"');
    const [[{ photos }]] = await db.promise().query('SELECT COUNT(*) AS photos FROM media WHERE type = "photo" AND status = "uploaded"');
    const [[{ audios }]] = await db.promise().query('SELECT COUNT(*) AS audios FROM media WHERE type = "audio" AND status = "uploaded"');

    res.json({
      success: true,
      data: { total_media, uploaded, pending, failed, total_users, videos, photos, audios },
    });
  } catch (err) {
    next(err);
  }
};
