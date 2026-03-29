const db = require('../config/db_config');
const logger = require('../utils/logger');

// ─── Get All Media (public) ───────────────────────────────────────────────────
exports.getAllMedia = async (req, res, next) => {
  try {
    const { type, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        m.id, m.type, m.title, m.thumbnail_url, m.status, m.created_at,
        u.name AS uploaded_by_name,
        mm.event_name, mm.location, mm.description, mm.speaker_name,
        mm.sermon_topic, mm.service_date,
        up_yt.youtube_link, up_yt.youtube_video_id,
        up_tg.telegram_msg_id
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      LEFT JOIN media_metadata mm ON m.id = mm.media_id
      LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube' AND up_yt.upload_status = 'success'
      LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram' AND up_tg.upload_status = 'success'
      WHERE m.status = 'uploaded'
    `;
    const params = [];

    if (type && ['video', 'photo', 'audio'].includes(type)) {
      query += ' AND m.type = ?';
      params.push(type);
    }
    if (search) {
      query += ' AND (mm.event_name LIKE ? OR mm.description LIKE ? OR mm.speaker_name LIKE ? OR m.title LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.promise().query(query, params);

    const [[{ total }]] = await db.promise().query(
      `SELECT COUNT(*) AS total FROM media m
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE m.status = 'uploaded'
       ${type ? 'AND m.type = ?' : ''}`,
      type ? [type] : []
    );

    res.json({
      success: true,
      data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Single Media ─────────────────────────────────────────────────────────
exports.getMediaById = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT m.*, u.name AS uploaded_by_name,
        mm.event_name, mm.location, mm.description, mm.participants,
        mm.speaker_name, mm.sermon_topic, mm.service_date,
        up_yt.youtube_link, up_yt.youtube_video_id,
        up_tg.telegram_msg_id
       FROM media m
       LEFT JOIN users u ON m.uploaded_by = u.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
       LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
       WHERE m.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Media not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── Create Media Entry (Admin) ───────────────────────────────────────────────
exports.createMedia = async (req, res, next) => {
  try {
    const { type, title, file_path, metadata } = req.body;
    if (!type || !['video', 'photo', 'audio'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Valid media type required' });
    }

    const [result] = await db.promise().query(
      'INSERT INTO media (type, title, file_path, status, uploaded_by) VALUES (?, ?, ?, "pending", ?)',
      [type, title || null, file_path || null, req.user.id]
    );

    const mediaId = result.insertId;

    if (metadata) {
      await db.promise().query(
        `INSERT INTO media_metadata 
         (media_id, event_name, location, description, participants, speaker_name, sermon_topic, service_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mediaId,
          metadata.event_name || null,
          metadata.location || null,
          metadata.description || null,
          metadata.participants || null,
          metadata.speaker_name || null,
          metadata.sermon_topic || null,
          metadata.service_date || null,
        ]
      );
    }

    // Create pending upload entries
    await db.promise().query(
      'INSERT INTO uploads (media_id, platform) VALUES (?, "telegram"), (?, "youtube")',
      [mediaId, mediaId]
    );

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['MEDIA_CREATED', req.user.id, `${type} media created: ${title}`]
    );

    res.status(201).json({ success: true, message: 'Media created', data: { id: mediaId } });
  } catch (err) {
    next(err);
  }
};

// ─── Update Media Metadata (Admin) ────────────────────────────────────────────
exports.updateMedia = async (req, res, next) => {
  try {
    const { title, metadata } = req.body;
    const mediaId = req.params.id;

    if (title) {
      await db.promise().query('UPDATE media SET title = ? WHERE id = ?', [title, mediaId]);
    }
    if (metadata) {
      await db.promise().query(
        `UPDATE media_metadata SET
         event_name = ?, location = ?, description = ?, participants = ?,
         speaker_name = ?, sermon_topic = ?, service_date = ?
         WHERE media_id = ?`,
        [
          metadata.event_name, metadata.location, metadata.description,
          metadata.participants, metadata.speaker_name, metadata.sermon_topic,
          metadata.service_date, mediaId,
        ]
      );
    }
    res.json({ success: true, message: 'Media updated' });
  } catch (err) {
    next(err);
  }
};

// ─── Delete Media (Admin) ─────────────────────────────────────────────────────
exports.deleteMedia = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query('SELECT * FROM media WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Media not found' });

    await db.promise().query('DELETE FROM media WHERE id = ?', [req.params.id]);
    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['MEDIA_DELETED', req.user.id, `Deleted media ID ${req.params.id}`]
    );
    res.json({ success: true, message: 'Media deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── Get Admin Media Queue ────────────────────────────────────────────────────
exports.getAdminQueue = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT m.*, mm.event_name, mm.speaker_name,
        up_yt.upload_status AS youtube_status, up_yt.youtube_link,
        up_tg.upload_status AS telegram_status, up_tg.telegram_msg_id
       FROM media m
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
       LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
       WHERE m.uploaded_by = ?
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Update Thumbnail ─────────────────────────────────────────────────────────
exports.updateThumbnail = async (req, res, next) => {
  try {
    const { thumbnail_url } = req.body;
    await db.promise().query('UPDATE media SET thumbnail_url = ? WHERE id = ?', [thumbnail_url, req.params.id]);
    res.json({ success: true, message: 'Thumbnail updated' });
  } catch (err) {
    next(err);
  }
};
