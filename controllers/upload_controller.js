// ═══════════════════════════════════════════════════════════════
//  GRACE CHURCH MEDIA — Upload Controller
//  Handles: queue display, upload triggering, retry, saved videos,
//           YouTube channel video caching
// ═══════════════════════════════════════════════════════════════
const db = require('../config/db_config');
const youtubeService = require('../services/youtube_service');
const telegramService = require('../services/telegram_service');
const logger = require('../utils/logger');

// ─── Internal helper: process one media upload ────────────────
async function triggerUploadByMediaId(mediaId, actor = 'system') {
  logger.media('TRIGGER', '?', mediaId, `by ${actor}`);

  const [mediaRows] = await db.promise().query(
    `SELECT m.*, mm.event_name, mm.description, mm.speaker_name,
            mm.sermon_topic, mm.service_date, mm.location
     FROM media m
     LEFT JOIN media_metadata mm ON m.id = mm.media_id
     WHERE m.id = ?`,
    [mediaId]
  );

  if (!mediaRows.length) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const media = mediaRows[0];
  logger.info(`TRIGGER | Found media: type=${media.type} title=${media.title} path=${media.file_path}`);

  const mediaType = media.type;
  const [uploadRows] = await db.promise().query(
    `SELECT platform, upload_status, youtube_link, youtube_video_id, telegram_msg_id
     FROM uploads
     WHERE media_id = ?`,
    [mediaId]
  );

  const uploadByPlatform = Object.fromEntries(
    uploadRows.map((row) => [row.platform, row])
  );
  const pendingPlatforms = uploadRows
    .filter((row) => row.upload_status === 'pending' || row.upload_status === 'failed')
    .map((row) => row.platform);
  const hasInProgress = uploadRows.some((row) => row.upload_status === 'in_progress');
  const allSuccessBeforeStart =
    uploadRows.length > 0 && uploadRows.every((row) => row.upload_status === 'success');

  if (allSuccessBeforeStart) {
    logger.media('SKIP', mediaType, mediaId, 'all platform uploads already succeeded');
    await db.promise().query(
      "UPDATE media SET status = 'uploaded' WHERE id = ?",
      [mediaId]
    );

    return {
      success: true,
      mediaId,
      finalStatus: 'uploaded',
      skipped: true,
    };
  }

  if (hasInProgress && pendingPlatforms.length === 0) {
    logger.media('SKIP', mediaType, mediaId, 'upload already in progress');
    return {
      success: true,
      mediaId,
      finalStatus: 'uploading',
      skipped: true,
    };
  }

  const shouldUploadYouTube = mediaType !== 'photo' && pendingPlatforms.includes('youtube');
  const shouldMarkPhotoYouTubeSuccess =
    mediaType === 'photo' && pendingPlatforms.includes('youtube');
  const shouldUploadTelegram = pendingPlatforms.includes('telegram');

  await db.promise().query(
    "UPDATE media SET status = 'uploading' WHERE id = ?",
    [mediaId]
  );

  if (shouldUploadYouTube || shouldMarkPhotoYouTubeSuccess) {
    await db.promise().query(
      `UPDATE uploads
       SET upload_status = 'in_progress',
           error_message = NULL
       WHERE media_id = ? AND platform = 'youtube'`,
      [mediaId]
    );
  }

  if (shouldUploadTelegram) {
    await db.promise().query(
      `UPDATE uploads
       SET upload_status = 'in_progress',
           error_message = NULL
       WHERE media_id = ? AND platform = 'telegram'`,
      [mediaId]
    );
  }

  let youtubeLink = null;
  let youtubeVideoId = null;
  let telegramMsgId = null;
  let ytError = null;
  let tgError = null;

  // ── YouTube Upload (videos and audio only) ────────────────
  if (shouldUploadYouTube) {
    try {
      logger.media('YT_START', mediaType, mediaId, 'uploading to YouTube...');
      const ytResult = await youtubeService.uploadMedia(media);
      youtubeLink = ytResult.link;
      youtubeVideoId = ytResult.videoId;

      await db.promise().query(
        `UPDATE uploads
         SET upload_status = 'success',
             youtube_link = ?,
             youtube_video_id = ?,
             upload_date = NOW(),
             error_message = NULL
         WHERE media_id = ? AND platform = 'youtube'`,
        [youtubeLink, youtubeVideoId, mediaId]
      );

      const thumbUrl = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;
      await db.promise().query(
        'UPDATE media SET thumbnail_url = ? WHERE id = ?',
        [thumbUrl, mediaId]
      );

      logger.media('YT_DONE', mediaType, mediaId, youtubeLink);
    } catch (err) {
      ytError = err.message;
      logger.error(`YT_FAIL | media:${mediaId} | ${err.message}`);

      await db.promise().query(
        `UPDATE uploads
         SET upload_status = 'failed',
             error_message = ?
         WHERE media_id = ? AND platform = 'youtube'`,
        [err.message, mediaId]
      );
    }
  } else if (shouldMarkPhotoYouTubeSuccess) {
    // photos skip YouTube for now
    await db.promise().query(
      `UPDATE uploads
       SET upload_status = 'success',
           upload_date = NOW(),
           error_message = NULL
       WHERE media_id = ? AND platform = 'youtube'`,
      [mediaId]
    );
  }

  // ── Telegram Upload (all types) ───────────────────────────
  if (shouldUploadTelegram) {
    try {
      logger.media('TG_START', mediaType, mediaId, 'sending to Telegram...');
      const existingYouTubeLink = shouldUploadYouTube
        ? youtubeLink
        : (uploadByPlatform.youtube?.youtube_link || null);
      const mediaWithLink = { ...media, youtube_link: existingYouTubeLink };
      const tgResult = await telegramService.sendMedia(mediaWithLink);
      telegramMsgId = tgResult.messageId;

      await db.promise().query(
        `UPDATE uploads
         SET upload_status = 'success',
             telegram_msg_id = ?,
             upload_date = NOW(),
             error_message = NULL
         WHERE media_id = ? AND platform = 'telegram'`,
        [telegramMsgId, mediaId]
      );

      logger.media('TG_DONE', mediaType, mediaId, `msg_id:${telegramMsgId}`);
    } catch (err) {
      tgError = err.message;
      logger.error(`TG_FAIL | media:${mediaId} | ${err.message}`);

      await db.promise().query(
        `UPDATE uploads
         SET upload_status = 'failed',
             error_message = ?
         WHERE media_id = ? AND platform = 'telegram'`,
        [err.message, mediaId]
      );
    }
  }

  // ── Set final media status ────────────────────────────────
  const [uploads] = await db.promise().query(
    'SELECT platform, upload_status FROM uploads WHERE media_id = ?',
    [mediaId]
  );

  const allSuccess = uploads.every((u) => u.upload_status === 'success');
  const anyFailed = uploads.some((u) => u.upload_status === 'failed');

  const finalStatus = allSuccess
    ? 'uploaded'
    : anyFailed
      ? 'failed'
      : 'uploading';

  await db.promise().query(
    'UPDATE media SET status = ? WHERE id = ?',
    [finalStatus, mediaId]
  );

  logger.media('COMPLETE', mediaType, mediaId, `final status: ${finalStatus}`);

  if (!ytError && mediaType !== 'photo') {
    setTimeout(async () => {
      try {
        await youtubeService.fetchChannelVideos();
        logger.info('YT | Channel video cache refreshed after upload');
      } catch (e) {
        logger.warn(`YT | Cache refresh failed: ${e.message}`);
      }
    }, 10000);
  }

  return {
    success: true,
    mediaId,
    telegramMsgId,
    youtubeLink,
    youtubeVideoId,
    finalStatus,
  };
}

// ─── GET Upload Queue (with full media details) ───────────────
exports.getUploadQueue = async (req, res, next) => {
  logger.info(`UPLOADS | getUploadQueue | by ${req.user?.email}`);
  try {
    const [rows] = await db.promise().query(
      `SELECT
         u.id, u.media_id, u.platform, u.upload_status,
         u.telegram_msg_id, u.youtube_link, u.youtube_video_id,
         u.retry_count, u.error_message, u.upload_date,
         u.created_at,
         m.type, m.title, m.file_path, m.status AS media_status,
         m.thumbnail_url,
         mm.event_name, mm.speaker_name, mm.sermon_topic
       FROM uploads u
       JOIN media m ON u.media_id = m.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       ORDER BY u.created_at DESC
       LIMIT 100`
    );

    logger.db('SELECT', 'uploads', `returned ${rows.length} records`);
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('getUploadQueue error:', err.message);
    next(err);
  }
};

// ─── UPDATE Upload Status ─────────────────────────────────────
exports.updateUploadStatus = async (req, res, next) => {
  const { mediaId } = req.params;
  const {
    platform,
    upload_status,
    telegram_msg_id,
    youtube_link,
    youtube_video_id,
    error_message,
  } = req.body;

  logger.info(`UPLOADS | updateStatus | media:${mediaId} platform:${platform} → ${upload_status}`);

  try {
    await db.promise().query(
      `UPDATE uploads SET
         upload_status    = ?,
         telegram_msg_id  = COALESCE(?, telegram_msg_id),
         youtube_link     = COALESCE(?, youtube_link),
         youtube_video_id = COALESCE(?, youtube_video_id),
         error_message    = COALESCE(?, error_message),
         upload_date      = IF(? = 'success', NOW(), upload_date)
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

    const [uploads] = await db.promise().query(
      'SELECT platform, upload_status FROM uploads WHERE media_id = ?',
      [mediaId]
    );

    const allSuccess = uploads.every((u) => u.upload_status === 'success');
    const anyFailed = uploads.some((u) => u.upload_status === 'failed');
    const newStatus = allSuccess ? 'uploaded' : anyFailed ? 'failed' : 'uploading';

    await db.promise().query(
      'UPDATE media SET status = ? WHERE id = ?',
      [newStatus, mediaId]
    );

    logger.media('STATUS_UPD', platform, mediaId, `→ ${upload_status} | media → ${newStatus}`);
    return res.json({ success: true, message: 'Status updated' });
  } catch (err) {
    logger.error('updateUploadStatus error:', err.message);
    next(err);
  }
};

// ─── TRIGGER Upload via HTTP route ────────────────────────────
exports.triggerUpload = async (req, res, next) => {
  const { mediaId } = req.params;

  try {
    res.json({
      success: true,
      message: 'Upload started',
      data: { mediaId: Number(mediaId) },
    });

    setImmediate(async () => {
      try {
        await triggerUploadByMediaId(mediaId, req.user?.email || 'route');
      } catch (err) {
        logger.error(`triggerUpload background error | media:${mediaId} | ${err.message}`);
        await db.promise().query(
          "UPDATE media SET status = 'failed' WHERE id = ?",
          [mediaId]
        ).catch(() => {});
      }
    });
  } catch (err) {
    logger.error('triggerUpload error:', err.message);
    next(err);
  }
};

// ─── RETRY Failed Uploads (cron) ─────────────────────────────
exports.retryFailedUploads = async () => {
  logger.info('CRON | Checking for failed uploads...');
  try {
    const [failedMediaRows] = await db.promise().query(
      `SELECT DISTINCT media_id
       FROM uploads
       WHERE upload_status = 'failed' AND retry_count < 3`
    );

    if (!failedMediaRows.length) {
      logger.info('CRON | No failed uploads');
      return;
    }

    logger.info(`CRON | Retrying ${failedMediaRows.length} failed media item(s)`);

    for (const row of failedMediaRows) {
      try {
        await db.promise().query(
          "UPDATE uploads SET retry_count = retry_count + 1 WHERE media_id = ? AND upload_status = 'failed'",
          [row.media_id]
        );

        await triggerUploadByMediaId(row.media_id, 'retry-cron');
      } catch (err) {
        logger.error(`RETRY_FAIL | media:${row.media_id} | ${err.message}`);
      }
    }
  } catch (err) {
    logger.error('retryFailedUploads:', err.message);
  }
};

// ─── GET YouTube Channel Videos (for home screen) ────────────
exports.getChannelVideos = async (req, res, next) => {
  logger.info('UPLOADS | getChannelVideos');
  try {
    const videos = await youtubeService.getCachedChannelVideos(20);
    return res.json({ success: true, data: videos });
  } catch (err) {
    logger.error('getChannelVideos error:', err.message);
    next(err);
  }
};

// ─── REFRESH YouTube Channel Videos (admin trigger) ──────────
exports.refreshChannelVideos = async (req, res, next) => {
  logger.info(`UPLOADS | refreshChannelVideos | by ${req.user?.email}`);
  try {
    const videos = await youtubeService.fetchChannelVideos();
    return res.json({
      success: true,
      message: `Fetched ${videos.length} videos`,
      data: videos,
    });
  } catch (err) {
    logger.error('refreshChannelVideos error:', err.message);
    next(err);
  }
};

// ─── SAVE Video for later (user action) ──────────────────────
exports.saveVideo = async (req, res, next) => {
  const userId = req.user.id;
  const { media_id, video_id, title, thumbnail_url, youtube_url } = req.body;
  logger.info(`UPLOADS | saveVideo | user:${userId} media:${media_id} ytVid:${video_id}`);

  try {
    if (!media_id && !video_id) {
      return res.status(400).json({ success: false, message: 'media_id or video_id required' });
    }

    await db.promise().query(
      `INSERT INTO saved_videos (user_id, media_id, video_id, title, thumbnail_url, youtube_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE saved_at = NOW()`,
      [
        userId,
        media_id || null,
        video_id || null,
        title || null,
        thumbnail_url || null,
        youtube_url || null,
      ]
    );

    logger.info(`UPLOADS | Video saved for user:${userId}`);
    return res.json({ success: true, message: 'Saved for later' });
  } catch (err) {
    logger.error('saveVideo error:', err.message);
    next(err);
  }
};

// ─── UNSAVE Video ─────────────────────────────────────────────
exports.unsaveVideo = async (req, res, next) => {
  const userId = req.user.id;
  const { media_id, video_id } = req.body;

  try {
    if (media_id) {
      await db.promise().query(
        'DELETE FROM saved_videos WHERE user_id = ? AND media_id = ?',
        [userId, media_id]
      );
    } else if (video_id) {
      await db.promise().query(
        'DELETE FROM saved_videos WHERE user_id = ? AND video_id = ?',
        [userId, video_id]
      );
    }

    return res.json({ success: true, message: 'Removed from saved' });
  } catch (err) {
    logger.error('unsaveVideo error:', err.message);
    next(err);
  }
};

// ─── GET Saved Videos for user ────────────────────────────────
exports.getSavedVideos = async (req, res, next) => {
  const userId = req.user.id;
  logger.info(`UPLOADS | getSavedVideos | user:${userId}`);

  try {
    const [rows] = await db.promise().query(
      `SELECT sv.*, m.type, m.status AS media_status,
              up.youtube_link, up.telegram_msg_id,
              mm.event_name, mm.speaker_name, mm.sermon_topic
       FROM saved_videos sv
       LEFT JOIN media m ON sv.media_id = m.id
       LEFT JOIN uploads up ON m.id = up.media_id AND up.platform = 'youtube'
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE sv.user_id = ?
       ORDER BY sv.saved_at DESC`,
      [userId]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('getSavedVideos error:', err.message);
    next(err);
  }
};

module.exports.triggerUploadByMediaId = triggerUploadByMediaId;
