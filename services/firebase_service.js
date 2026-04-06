const fs = require('fs');
const admin = require('firebase-admin');
const config = require('../config/app_config');
const logger = require('../utils/logger');

let initialized = false;

function getServiceAccount() {
  if (config.firebase.serviceAccountJson) {
    try {
      return JSON.parse(config.firebase.serviceAccountJson);
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }

  if (config.firebase.serviceAccountPath) {
    const raw = fs.readFileSync(config.firebase.serviceAccountPath, 'utf8');
    return JSON.parse(raw);
  }

  throw new Error('Firebase service account not configured');
}

function initialize() {
  if (initialized) return admin.messaging();

  const serviceAccount = getServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  initialized = true;
  logger.startup('Firebase Admin initialized');
  return admin.messaging();
}

async function sendTimelyReflectionNotification({ tokens, topic, reflectionId }) {
  if (!tokens || !tokens.length) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const messaging = initialize();
  const message = {
    tokens,
    notification: {
      title: 'New Daily Timely Reflection',
      body: topic,
    },
    data: {
      type: 'timely_reflection',
      topic,
      reflection_id: String(reflectionId),
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'timely_reflection_channel',
      },
    },
  };

  return messaging.sendEachForMulticast(message);
}

module.exports = {
  initialize,
  sendTimelyReflectionNotification,
};
