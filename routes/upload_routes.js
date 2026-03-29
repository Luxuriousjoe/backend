// ─── upload_routes.js ─────────────────────────────────────────────────────────
const express = require('express');
const uploadRouter = express.Router();
const uploadController = require('../controllers/upload_controller');
const { adminMiddleware } = require('../middleware/auth_middleware');

uploadRouter.get('/', adminMiddleware, uploadController.getUploadQueue);
uploadRouter.patch('/:mediaId/status', adminMiddleware, uploadController.updateUploadStatus);
uploadRouter.post('/:mediaId/trigger', adminMiddleware, uploadController.triggerUpload);

module.exports = uploadRouter;

// ─── admin_routes.js ──────────────────────────────────────────────────────────
const adminExpress = require('express');
const adminRouter = adminExpress.Router();
const adminController = require('../controllers/admin_controller');
const { adminMiddleware: adminOnly } = require('../middleware/auth_middleware');

adminRouter.get('/users', adminOnly, adminController.getAllUsers);
adminRouter.post('/users', adminOnly, adminController.createUser);
adminRouter.post('/admins', adminOnly, adminController.createAdmin);
adminRouter.patch('/users/:id/toggle', adminOnly, adminController.toggleUser);
adminRouter.get('/logs', adminOnly, adminController.getLogs);
adminRouter.get('/stats', adminOnly, adminController.getDashboardStats);

// Export both — note: server.js imports them separately
// This file exports uploadRouter as default for upload_routes.js
