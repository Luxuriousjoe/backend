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
  logger.startup(
    `Firebase Admin config loaded for project: ${serviceAccount.project_id || 'unknown-project'}`
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  initialized = true;
  logger.startup('Firebase Admin initialized');
  return admin.messaging();
}

async function sendTimelyReflectionNotification({ tokens, topic, reflectionId }) {
  if (!tokens || !tokens.length) {
    logger.warn('TIMELY_REFLECTION_PUSH skipped: no device tokens to send');
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const messaging = initialize();
  logger.info(
    `TIMELY_REFLECTION_PUSH sending to ${tokens.length} device(s) for reflection:${reflectionId}`
  );
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
      ttl: 60 * 60 * 1000,
      notification: {
        channelId: 'timely_reflection_channel',
        priority: 'max',
        defaultSound: true,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          sound: 'default',
          contentAvailable: true,
        },
      },
    },
  };

  return messaging.sendEachForMulticast(message);
}

async function sendAppUpdateNotification({
  tokens,
  latestVersion,
  forceUpdate = false,
  body,
}) {
  if (!tokens || !tokens.length) {
    logger.warn('APP_UPDATE_PUSH skipped: no device tokens to send');
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const messaging = initialize();
  const finalBody =
    body ||
    (forceUpdate
      ? `Version ${latestVersion} is required. Please update now.`
      : `Version ${latestVersion} is ready to install.`);

  logger.info(
    `APP_UPDATE_PUSH sending to ${tokens.length} device(s) for version:${latestVersion} force:${forceUpdate}`
  );

  const message = {
    tokens,
    notification: {
      title: forceUpdate ? 'Required App Update' : 'App Update Available',
      body: finalBody,
    },
    data: {
      type: 'app_update',
      latest_version: String(latestVersion || ''),
      force_update: forceUpdate ? '1' : '0',
      body: finalBody,
    },
    android: {
      priority: 'high',
      ttl: 60 * 60 * 1000,
      notification: {
        channelId: 'app_update_channel',
        priority: 'max',
        defaultSound: true,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          sound: 'default',
          contentAvailable: true,
        },
      },
    },
  };

  return messaging.sendEachForMulticast(message);
}

module.exports = {
  initialize,
  sendTimelyReflectionNotification,
  sendAppUpdateNotification,
};
