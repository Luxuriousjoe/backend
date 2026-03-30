// ═══════════════════════════════════════════════════════════════
//  GRACE CHURCH MEDIA — App Config
// ═══════════════════════════════════════════════════════════════
module.exports = {
  youtube: {
    clientId:     process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri:  process.env.YOUTUBE_REDIRECT_URI,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    channelId:    process.env.YOUTUBE_CHANNEL_ID,
  },
  telegram: {
    botToken:  process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
  },
  jwt: {
    secret:         process.env.JWT_SECRET       || 'grace_fallback_secret_change_in_prod',
    expiresIn:      process.env.JWT_EXPIRES_IN   || '7d',
    refreshSecret:  process.env.JWT_REFRESH_SECRET  || 'grace_fallback_refresh_change_in_prod',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 500,
  },
};
