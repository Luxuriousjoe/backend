const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db_config');
const config = require('../config/app_config');
const logger = require('../utils/logger');

// ─── Helper: Generate Tokens ──────────────────────────────────────────────────
const generateTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ id: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpires });
  return { accessToken, refreshToken };
};

// ─── Login ────────────────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const [rows] = await db.promise().query(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email.toLowerCase().trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );

    // Log login
    await db.promise().query(
      'INSERT INTO logs (action, user_id, details, ip_addr) VALUES (?, ?, ?, ?)',
      ['USER_LOGIN', user.id, `Login by ${user.email}`, req.ip]
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Refresh Token ────────────────────────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const [tokenRows] = await db.promise().query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refreshToken]
    );

    if (!tokenRows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const [userRows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!userRows.length) return res.status(401).json({ success: false, message: 'User not found' });

    const user = userRows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Replace old refresh token
    await db.promise().query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, newRefreshToken, expiresAt]
    );

    res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }
    next(err);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.promise().query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Get Current User ─────────────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      'SELECT id, name, email, role, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── Change Password ──────────────────────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const [rows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.promise().query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
};
