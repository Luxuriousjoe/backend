// ═══════════════════════════════════════════════════════════════
//  GRACE CHURCH MEDIA — Auth Controller
//  Every login attempt, success, failure is logged to Render
// ═══════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db_config');
const config = require('../config/app_config');
const logger = require('../utils/logger');

// ─── Helper: Generate Tokens ──────────────────────────────────
const generateTokens = (user) => {
  const payload = {
    id:    user.id,
    email: user.email,
    role:  user.role,
    name:  user.name,
  };
  const accessToken  = jwt.sign(payload, config.jwt.secret,        { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ id: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpires });
  return { accessToken, refreshToken };
};

// ─── LOGIN ────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  logger.auth('LOGIN_ATTEMPT', email || 'NO_EMAIL', '?', ip);

  try {
    // Validate input
    if (!email || !password) {
      logger.warn(`LOGIN_FAIL | Missing email or password | ip:${ip}`);
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    logger.db('SELECT', 'users', `looking up email: ${cleanEmail}`);

    // Find user
    const [rows] = await db.promise().query(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [cleanEmail]
    );

    logger.db('RESULT', 'users', `found ${rows.length} user(s) for email: ${cleanEmail}`);

    if (!rows.length) {
      logger.warn(`LOGIN_FAIL | User not found: ${cleanEmail} | ip:${ip}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];
    logger.info(`LOGIN | User found: id:${user.id} name:${user.name} role:${user.role}`);

    // Compare password
    logger.info(`LOGIN | Comparing password for user id:${user.id}...`);
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      logger.warn(`LOGIN_FAIL | Wrong password for: ${cleanEmail} | ip:${ip}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    logger.info(`LOGIN | Password matched for user id:${user.id}`);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);
    logger.info(`LOGIN | Tokens generated for user id:${user.id}`);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );
    logger.db('INSERT', 'refresh_tokens', `saved refresh token for user id:${user.id}`);

    // Write to logs table
    await db.promise().query(
      'INSERT INTO logs (action, user_id, details, ip_addr) VALUES (?, ?, ?, ?)',
      ['USER_LOGIN', user.id, `Successful login by ${user.email}`, ip]
    );
    logger.db('INSERT', 'logs', `login event logged for user id:${user.id}`);

    logger.auth('LOGIN_SUCCESS', user.email, user.role, ip);

    return res.json({
      success: true,
      message: 'Login successful — welcome to Grace Church Media!',
      data: {
        accessToken,
        refreshToken,
        user: {
          id:         user.id,
          name:       user.name,
          email:      user.email,
          role:       user.role,
          avatar_url: user.avatar_url,
        },
      },
    });

  } catch (err) {
    logger.error(`LOGIN_ERROR | ${err.message} | email:${email} | ip:${ip}`);
    logger.error('Stack:', err.stack);
    next(err);
  }
};

// ─── REFRESH TOKEN ─────────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  logger.info('REFRESH_TOKEN | Refresh token request received');
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      logger.warn('REFRESH_TOKEN | No token provided in request body');
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch (jwtErr) {
      logger.warn(`REFRESH_TOKEN | JWT verify failed: ${jwtErr.message}`);
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    logger.db('SELECT', 'refresh_tokens', `checking token for user id:${decoded.id}`);
    const [tokenRows] = await db.promise().query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refreshToken]
    );

    if (!tokenRows.length) {
      logger.warn(`REFRESH_TOKEN | Token not found or expired for user id:${decoded.id}`);
      return res.status(401).json({ success: false, message: 'Refresh token expired — please log in again' });
    }

    const [userRows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!userRows.length) {
      logger.warn(`REFRESH_TOKEN | User id:${decoded.id} not found`);
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = userRows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Rotate refresh token
    await db.promise().query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, newRefreshToken, expiresAt]
    );

    logger.auth('TOKEN_REFRESH', user.email, user.role, req.ip);
    return res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });

  } catch (err) {
    logger.error('REFRESH_TOKEN_ERROR:', err.message);
    next(err);
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  logger.info('LOGOUT | Logout request received');
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const [result] = await db.promise().query(
        'DELETE FROM refresh_tokens WHERE token = ?',
        [refreshToken]
      );
      logger.db('DELETE', 'refresh_tokens', `removed ${result.affectedRows} token(s)`);
    }
    logger.auth('LOGOUT', req.user?.email || 'unknown', req.user?.role || '?', req.ip);
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.error('LOGOUT_ERROR:', err.message);
    next(err);
  }
};

// ─── GET ME ───────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
  logger.info(`GET_ME | Fetching profile for user id:${req.user?.id}`);
  try {
    const [rows] = await db.promise().query(
      'SELECT id, name, email, role, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) {
      logger.warn(`GET_ME | User id:${req.user.id} not found in DB`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    logger.info(`GET_ME | Returned profile for ${rows[0].email}`);
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('GET_ME_ERROR:', err.message);
    next(err);
  }
};

// ─── CHANGE PASSWORD ──────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  logger.info(`CHANGE_PASSWORD | Request from user id:${req.user?.id}`);
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const [rows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      logger.warn(`CHANGE_PASSWORD | Wrong current password for user id:${user.id}`);
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await db.promise().query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

    logger.auth('PWD_CHANGED', user.email, user.role, req.ip);
    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    logger.error('CHANGE_PASSWORD_ERROR:', err.message);
    next(err);
  }
};
