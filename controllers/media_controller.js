const fs = require('fs');
const path = require('path');
const db = require('../config/db_config');
const telegramService = require('../services/telegram_service');
const logger = require('../utils/logger');

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

let uploadsColumnCache = null;

async function getUploadsColumns() {
  if (uploadsColumnCache) {
    return uploadsColumnCache;
  }

  const [rows] = await db.promise().query('SHOW COLUMNS FROM uploads');
  uploadsColumnCache = new Set(rows.map((row) => row.Field));
  return uploadsColumnCache;
}

function streamLocalFile({ filePath, wantsDownload, res }) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || 'application/octet-stream';
  const fileName = path.basename(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader(
    'Content-Disposition',
    `${wantsDownload ? 'attachment' : 'inline'}; filename="${fileName}"`
  );

  return { fileSize, fileName };
}

// ─── GET ALL MEDIA ────────────────────────────────────────────
exports.getAllMedia = async (req, res, next) => {
  const { type, page = 1, limit = 20, search } = req.query;
  logger.info(`MEDIA | getAllMedia | type:${type || 'all'} page:${page} search:${search || 'none'}`);

  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT
        m.id,
        m.type AS type,
        m.title,
        m.thumbnail_url,
        m.status,
        m.created_at,
        u.name AS uploaded_by_name,
        mm.event_name,
        mm.location,
        mm.description,
        mm.speaker_name,
        mm.sermon_topic,
        mm.service_date,
        up_yt.youtube_link,
        up_yt.youtube_video_id,
        up_tg.telegram_msg_id
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      LEFT JOIN media_metadata mm ON m.id = mm.media_id
      LEFT JOIN uploads up_yt
        ON m.id = up_yt.media_id
       AND up_yt.platform = 'youtube'
       AND up_yt.upload_status = 'success'
      LEFT JOIN uploads up_tg
        ON m.id = up_tg.media_id
       AND up_tg.platform = 'telegram'
       AND up_tg.upload_status = 'success'
      WHERE m.status = 'uploaded'
    `;

    const params = [];

    if (type && ['video', 'photo', 'audio'].includes(type)) {
      query += ` AND m.type = ?`;
      params.push(type);
    }

    if (search) {
      query += ` AND (
        mm.event_name LIKE ?
        OR mm.description LIKE ?
        OR mm.speaker_name LIKE ?
        OR m.title LIKE ?
      )`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [rows] = await db.promise().query(query, params);

    logger.db('SELECT', 'media', `returned ${rows.length} items`);
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('getAllMedia error:', err.message);
    next(err);
  }
};

// ─── GET MEDIA BY ID ──────────────────────────────────────────
exports.getMediaById = async (req, res, next) => {
  const { id } = req.params;
  logger.info(`MEDIA | getMediaById | id:${id}`);

  try {
    const [rows] = await db.promise().query(
      `SELECT
        m.id,
        m.type AS type,
        m.file_path,
        m.title,
        m.thumbnail_url,
        m.status,
        m.created_at,
        u.name AS uploaded_by_name,
        mm.event_name,
        mm.location,
        mm.description,
        mm.participants,
        mm.speaker_name,
        mm.sermon_topic,
        mm.service_date,
        up_yt.youtube_link,
        up_yt.youtube_video_id,
        up_tg.telegram_msg_id
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      LEFT JOIN media_metadata mm ON m.id = mm.media_id
      LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
      LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
      WHERE m.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getMediaById error:', err.message);
    next(err);
  }
};

exports.streamMediaFile = async (req, res, next) => {
  const { id } = req.params;
  const wantsDownload = req.query.download === '1';

  try {
    const uploadColumns = await getUploadsColumns();
    const tgFileIdSelect = uploadColumns.has('telegram_file_id')
      ? 'up_tg.telegram_file_id'
      : 'NULL AS telegram_file_id';
    const tgFilePathSelect = uploadColumns.has('telegram_file_path')
      ? 'up_tg.telegram_file_path'
      : 'NULL AS telegram_file_path';

    const [rows] = await db.promise().query(
      `SELECT
         m.id,
         m.type,
         m.file_path,
         m.title,
         up_tg.telegram_msg_id,
         ${tgFileIdSelect},
         ${tgFilePathSelect},
         up_yt.youtube_link,
         up_yt.youtube_video_id
       FROM media m
       LEFT JOIN uploads up_tg
         ON m.id = up_tg.media_id
        AND up_tg.platform = 'telegram'
        AND up_tg.upload_status = 'success'
       LEFT JOIN uploads up_yt
         ON m.id = up_yt.media_id
        AND up_yt.platform = 'youtube'
        AND up_yt.upload_status = 'success'
       WHERE m.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    const media = rows[0];
    if (media.file_path && fs.existsSync(media.file_path)) {
      const { fileSize } = streamLocalFile({
        filePath: media.file_path,
        wantsDownload,
        res,
      });

      const range = req.headers.range;
      if (range) {
        const [startText, endText] = range.replace(/bytes=/, '').split('-');
        const start = Number.parseInt(startText, 10);
        const end = endText ? Number.parseInt(endText, 10) : fileSize - 1;

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(media.file_path, { start, end }).pipe(res);
        return;
      }

      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(media.file_path).pipe(res);
      return;
    }

    if (media.telegram_file_id || media.telegram_file_path) {
      const fallbackName = media.title
        ? `${media.title}${path.extname(media.file_path || '') || ''}`
        : `media-${media.id}`;

      await telegramService.streamFileToResponse({
        fileId: media.telegram_file_id,
        filePath: media.telegram_file_path,
        res,
        wantsDownload,
        fileName: fallbackName,
      });
      return;
    }

    const platformHint = media.youtube_link
      ? 'The original file is unavailable on the server. YouTube playback is still available, but direct file download is not supported by the YouTube API.'
      : 'Media file not available. To support Telegram fallback downloads, store telegram_file_id and telegram_file_path on upload success.';

    return res.status(404).json({
      success: false,
      message: platformHint,
    });
  } catch (err) {
    logger.error('streamMediaFile error:', err.message);
    next(err);
  }
};

// ─── CREATE MEDIA ─────────────────────────────────────────────
exports.createMedia = async (req, res, next) => {
  try {
    const { type, title } = req.body;
    const metadataRaw = req.body.metadata;

    if (!type || !['video', 'photo', 'audio'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Valid media type required (video/photo/audio)',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No media file uploaded',
      });
    }

    const metadata = typeof metadataRaw === 'string'
      ? JSON.parse(metadataRaw)
      : (metadataRaw || {});

    const serverFilePath = req.file.path;

    const [columnCheck] = await db.promise().query("SHOW COLUMNS FROM media LIKE 'type'");
    const hasTypeColumn = Array.isArray(columnCheck) && columnCheck.length > 0;
    const typeColumn = hasTypeColumn ? 'type' : 'media_type';

    const [result] = await db.promise().query(
      `INSERT INTO media (${typeColumn}, title, file_path, status, uploaded_by)
       VALUES (?, ?, ?, 'pending', ?)`,
      [type, title || null, serverFilePath, req.user.id]
    );

    const mediaId = result.insertId;

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

    await db.promise().query(
      `INSERT INTO uploads (media_id, platform, upload_status)
       VALUES (?, 'telegram', 'pending'), (?, 'youtube', 'pending')`,
      [mediaId, mediaId]
    );

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['MEDIA_CREATED', req.user.id, `${type} media created: ${title || 'Untitled'}`]
    );

    

const uploadController = require('./upload_controller');

console.log('🚀 ABOUT TO TRIGGER UPLOAD for media:', mediaId);

try {
  await uploadController.triggerUploadByMediaId(mediaId);
  console.log('✅ UPLOAD TRIGGERED SUCCESSFULLY for media:', mediaId);
} catch (err) {
  console.error('❌ UPLOAD TRIGGER FAILED:', err.message);
}

    return res.status(201).json({
      success: true,
      message: 'Media entry created',
      data: { id: mediaId },
    });
  } catch (err) {
    logger.error('createMedia error:', err.message);
    next(err);
  }
};

// ─── UPDATE MEDIA ─────────────────────────────────────────────
exports.updateMedia = async (req, res, next) => {
  const { id } = req.params;

  try {
    const { title, metadata } = req.body;

    if (title) {
      await db.promise().query(
        'UPDATE media SET title = ? WHERE id = ?',
        [title, id]
      );
    }

    if (metadata) {
      await db.promise().query(
        `UPDATE media_metadata
         SET event_name = ?, location = ?, description = ?, participants = ?,
             speaker_name = ?, sermon_topic = ?, service_date = ?
         WHERE media_id = ?`,
        [
          metadata.event_name || null,
          metadata.location || null,
          metadata.description || null,
          metadata.participants || null,
          metadata.speaker_name || null,
          metadata.sermon_topic || null,
          metadata.service_date || null,
          id
        ]
      );
    }

    return res.json({ success: true, message: 'Media updated' });
  } catch (err) {
    logger.error('updateMedia error:', err.message);
    next(err);
  }
};

// ─── DELETE MEDIA ─────────────────────────────────────────────
exports.deleteMedia = async (req, res, next) => {
  const { id } = req.params;

  try {
    const [rows] = await db.promise().query(
      'SELECT * FROM media WHERE id = ?',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    await db.promise().query('DELETE FROM media WHERE id = ?', [id]);
    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['MEDIA_DELETED', req.user.id, `Deleted media id:${id}`]
    );

    return res.json({ success: true, message: 'Media deleted' });
  } catch (err) {
    logger.error('deleteMedia error:', err.message);
    next(err);
  }
};

// ─── ADMIN QUEUE ──────────────────────────────────────────────
exports.getAdminQueue = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT
        m.*,
        mm.event_name,
        mm.speaker_name,
        up_yt.upload_status AS youtube_status,
        up_yt.youtube_link,
        up_tg.upload_status AS telegram_status,
        up_tg.telegram_msg_id
      FROM media m
      LEFT JOIN media_metadata mm ON m.id = mm.media_id
      LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
      LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
      WHERE m.uploaded_by = ?
      ORDER BY m.created_at DESC
      LIMIT 50`,
      [req.user.id]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('getAdminQueue error:', err.message);
    next(err);
  }
};

// ─── UPDATE THUMBNAIL ─────────────────────────────────────────
exports.updateThumbnail = async (req, res, next) => {
  const { id } = req.params;
  const { thumbnail_url } = req.body;

  try {
    await db.promise().query(
      'UPDATE media SET thumbnail_url = ? WHERE id = ?',
      [thumbnail_url, id]
    );

    return res.json({ success: true, message: 'Thumbnail updated' });
  } catch (err) {
    logger.error('updateThumbnail error:', err.message);
    next(err);
  }
};
