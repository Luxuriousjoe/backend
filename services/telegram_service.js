const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const config = require('../config/app_config');
const logger = require('../utils/logger');

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;

// ─── Build Caption ────────────────────────────────────────────────────────────
const buildCaption = (media) => {
  const lines = [];
  if (media.event_name) lines.push(`📢 *${media.event_name}*`);
  if (media.speaker_name) lines.push(`🎤 Speaker: ${media.speaker_name}`);
  if (media.sermon_topic) lines.push(`📖 Topic: ${media.sermon_topic}`);
  if (media.service_date) lines.push(`📅 Date: ${media.service_date}`);
  if (media.location) lines.push(`📍 Location: ${media.location}`);
  if (media.description) lines.push(`\n${media.description}`);
  lines.push('\n🙏 Grace Church Media');
  return lines.join('\n');
};

// ─── Send Media to Telegram ───────────────────────────────────────────────────
exports.sendMedia = async (media) => {
  const caption = buildCaption(media);
  const channelId = config.telegram.channelId;

  let endpoint, formField;
  switch (media.type) {
    case 'video':
      endpoint = 'sendVideo';
      formField = 'video';
      break;
    case 'audio':
      endpoint = 'sendAudio';
      formField = 'audio';
      break;
    case 'photo':
    default:
      endpoint = 'sendPhoto';
      formField = 'photo';
      break;
  }

  const formData = new FormData();
  formData.append('chat_id', channelId);
  formData.append('caption', caption);
  formData.append('parse_mode', 'Markdown');

  if (media.file_path && fs.existsSync(media.file_path)) {
    formData.append(formField, fs.createReadStream(media.file_path));
  } else if (media.youtube_link) {
    // Send as text message with YouTube link instead
    return await exports.sendTextMessage(media, media.youtube_link);
  }

  logger.info(`Sending to Telegram (${media.type}): ${media.event_name || media.title}`);

  const response = await axios.post(`${BASE_URL}/${endpoint}`, formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  if (!response.data.ok) {
    throw new Error(`Telegram error: ${response.data.description}`);
  }

  const messageId = response.data.result.message_id;
  logger.info(`✅ Telegram upload success: message ID ${messageId}`);
  return { messageId: String(messageId) };
};

// ─── Send Text/Link Message ───────────────────────────────────────────────────
exports.sendTextMessage = async (media, youtubeLink) => {
  const caption = buildCaption(media);
  const text = `${caption}\n\n▶️ [Watch on YouTube](${youtubeLink})`;

  const response = await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: config.telegram.channelId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false,
  });

  if (!response.data.ok) {
    throw new Error(`Telegram error: ${response.data.description}`);
  }

  return { messageId: String(response.data.result.message_id) };
};
