const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config/app_config');
const logger = require('../utils/logger');

// ─── OAuth2 Client Setup ──────────────────────────────────────────────────────
const getOAuth2Client = () => {
  const oauth2Client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  oauth2Client.setCredentials({ refresh_token: config.youtube.refreshToken });
  return oauth2Client;
};

// ─── Upload Media to YouTube ──────────────────────────────────────────────────
exports.uploadMedia = async (media) => {
  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });

  const title = media.event_name
    ? `${media.event_name} — ${media.speaker_name || 'Church Media'}`
    : media.title || 'Church Service Media';

  const description = [
    media.description || '',
    media.speaker_name ? `Speaker: ${media.speaker_name}` : '',
    media.sermon_topic ? `Topic: ${media.sermon_topic}` : '',
    media.service_date ? `Date: ${media.service_date}` : '',
    '\nShared by Grace Church Media App',
  ].filter(Boolean).join('\n');

  const mimeType = media.type === 'video' ? 'video/mp4' : 'audio/mpeg';

  logger.info(`Uploading to YouTube: ${title}`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags: ['church', 'sermon', 'worship', media.sermon_topic || ''].filter(Boolean),
        categoryId: '22', // People & Blogs
      },
      status: { privacyStatus: 'public' },
    },
    media: {
      mimeType,
      body: fs.createReadStream(media.file_path),
    },
  });

  const videoId = response.data.id;
  const link = `https://www.youtube.com/watch?v=${videoId}`;
  logger.info(`✅ YouTube upload success: ${link}`);
  return { videoId, link };
};

// ─── Get Upload URL (for resumable uploads from Flutter) ─────────────────────
exports.getUploadUrl = async (mediaInfo) => {
  const auth = getOAuth2Client();
  const accessTokenResponse = await auth.getAccessToken();
  return { accessToken: accessTokenResponse.token };
};
