const db = require('../config/db_config');
const youtubeService = require('../services/youtube_service');
const telegramService = require('../services/telegram_service');
const logger = require('../utils/logger');

// ─── Get Upload Queue ─────────────────────────────────────────────────────────
exports.getUploadQueue = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT u.*, m.type, m.title, m.file_path, mm.event_name
       FROM uploads u
       JOIN media m ON u.media_id = m.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       ORDER BY u.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Update Upload Status ─────────────────────────────────────────────────────
exports.updateUploadStatus = async (req, res, next) => {
  try {
    const { platform, upload_status, telegram_msg_id, youtube_link, youtube_video_id, error_message } = req.body;
    const mediaId = req.params.mediaId;

    await db.promise().query(
      `UPDATE uploads SET
        upload_status = ?,
        telegram_msg_id = COALESCE(?, telegram_msg_id),
        youtube_link = COALESCE(?, youtube_link),
        youtube_video_id = COALESCE(?, youtube_video_id),
        error_message = COALESCE(?, error_message),
        upload_date = IF(? = 'success', NOW(), upload_date)
       WHERE media_id = ? AND platform = ?`,
      [
        upload_status,
        telegram_msg_id || null,
        youtube_link || null,
        youtube_video_id || null,
        error_message || null,
        upload_status,
        mediaId,
        platform,
      ]
    );

    // Check if both platforms succeeded → update media status
    const [uploads] = await db.promise().query(
      'SELECT platform, upload_status FROM uploads WHERE media_id = ?',
      [mediaId]
    );

    const allSuccess = uploads.every(u => u.upload_status === 'success');
    const anyFailed = uploads.some(u => u.upload_status === 'failed');

    if (allSuccess) {
      await db.promise().query('UPDATE media SET status = "uploaded" WHERE id = ?', [mediaId]);
    } else if (anyFailed) {
      await db.promise().query('UPDATE media SET status = "failed" WHERE id = ?', [mediaId]);
    } else {
      await db.promise().query('UPDATE media SET status = "uploading" WHERE id = ?', [mediaId]);
    }

    res.json({ success: true, message: 'Upload status updated' });
  } catch (err) {
    next(err);
  }
};

// ─── Trigger Upload (Admin) ───────────────────────────────────────────────────
exports.triggerUpload = async (req, res, next) => {
  try {
    const mediaId = req.params.mediaId;
    const [mediaRows] = await db.promise().query(
      `SELECT m.*, mm.event_name, mm.description, mm.speaker_name, mm.sermon_topic, mm.service_date
       FROM media m
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE m.id = ?`,
      [mediaId]
    );

    if (!mediaRows.length) return res.status(404).json({ success: false, message: 'Media not found' });

    const media = mediaRows[0];

    // Respond immediately — upload happens async
    res.json({ success: true, message: 'Upload triggered', data: { mediaId } });

    // Async upload
    await db.promise().query('UPDATE media SET status = "uploading" WHERE id = ?', [mediaId]);

    try {
      if (media.type !== 'photo') {
        // YouTube upload for video/audio
        const ytResult = await youtubeService.uploadMedia(media);
        await db.promise().query(
          `UPDATE uploads SET upload_status = 'success', youtube_link = ?, youtube_video_id = ?, upload_date = NOW()
           WHERE media_id = ? AND platform = 'youtube'`,
          [ytResult.link, ytResult.videoId, mediaId]
        );
      }

      // Telegram upload for all types
      const tgResult = await telegramService.sendMedia(media);
      await db.promise().query(
        `UPDATE uploads SET upload_status = 'success', telegram_msg_id = ?, upload_date = NOW()
         WHERE media_id = ? AND platform = 'telegram'`,
        [tgResult.messageId, mediaId]
      );

      await db.promise().query('UPDATE media SET status = "uploaded" WHERE id = ?', [mediaId]);
      logger.info(`✅ Media ${mediaId} uploaded successfully`);
    } catch (uploadErr) {
      logger.error(`❌ Upload failed for media ${mediaId}:`, uploadErr.message);
      await db.promise().query('UPDATE media SET status = "failed" WHERE id = ?', [mediaId]);
    }
  } catch (err) {
    next(err);
  }
};

// ─── Cron: Retry Failed Uploads ───────────────────────────────────────────────
exports.retryFailedUploads = async () => {
  try {
    const [failedUploads] = await db.promise().query(
      `SELECT u.*, m.file_path, m.type, m.title,
        mm.event_name, mm.description, mm.speaker_name
       FROM uploads u
       JOIN media m ON u.media_id = m.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE u.upload_status = 'failed' AND u.retry_count < 3`
    );

    for (const upload of failedUploads) {
      logger.info(`Retrying upload ${upload.id} (${upload.platform})`);
      await db.promise().query(
        'UPDATE uploads SET upload_status = "in_progress", retry_count = retry_count + 1 WHERE id = ?',
        [upload.id]
      );

      try {
        if (upload.platform === 'youtube' && upload.type !== 'photo') {
          const ytResult = await youtubeService.uploadMedia(upload);
          await db.promise().query(
            `UPDATE uploads SET upload_status = 'success', youtube_link = ?, youtube_video_id = ?, upload_date = NOW()
             WHERE id = ?`,
            [ytResult.link, ytResult.videoId, upload.id]
          );
        } else if (upload.platform === 'telegram') {
          const tgResult = await telegramService.sendMedia(upload);
          await db.promise().query(
            `UPDATE uploads SET upload_status = 'success', telegram_msg_id = ?, upload_date = NOW()
             WHERE id = ?`,
            [tgResult.messageId, upload.id]
          );
        }
      } catch (err) {
        await db.promise().query(
          'UPDATE uploads SET upload_status = "failed", error_message = ? WHERE id = ?',
          [err.message, upload.id]
        );
      }
    }
  } catch (err) {
    logger.error('Retry failed uploads error:', err.message);
  }
};
