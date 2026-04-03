// ─── CREATE MEDIA (Admin) ─────────────────────────────────────
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

    const { triggerUploadByMediaId } = require('./upload_controller');

    setImmediate(async () => {
      try {
        await triggerUploadByMediaId(mediaId, req.user?.email || 'createMedia');
        logger.info(`MEDIA | Background upload started for media:${mediaId}`);
      } catch (err) {
        logger.error(`MEDIA | Background upload failed for media:${mediaId} | ${err.message}`);
        await db.promise().query(
          'UPDATE media SET status = "failed" WHERE id = ?',
          [mediaId]
        ).catch(() => {});
      }
    });

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
