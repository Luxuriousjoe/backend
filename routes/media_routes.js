const express = require('express');
const router = express.Router();

const mediaController = require('../controllers/media_controller');
const middleware = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

const authMiddleware = middleware.authMiddleware;
const adminMiddleware = middleware.adminMiddleware;

// Debug checks - remove later if you want
console.log('mediaController keys:', Object.keys(mediaController));
console.log('authMiddleware type:', typeof authMiddleware);
console.log('adminMiddleware type:', typeof adminMiddleware);
console.log('getAllMedia type:', typeof mediaController.getAllMedia);
console.log('getAdminQueue type:', typeof mediaController.getAdminQueue);
console.log('getMediaById type:', typeof mediaController.getMediaById);
console.log('createMedia type:', typeof mediaController.createMedia);
console.log('updateMedia type:', typeof mediaController.updateMedia);
console.log('deleteMedia type:', typeof mediaController.deleteMedia);
console.log('updateThumbnail type:', typeof mediaController.updateThumbnail);

// Authenticated media routes
router.get('/', authMiddleware, mediaController.getAllMedia);
router.get('/queue/admin', adminMiddleware, mediaController.getAdminQueue);
router.get('/:id', authMiddleware, mediaController.getMediaById);

// Admin routes
router.post('/', adminMiddleware, upload.single('file'), mediaController.createMedia);
router.put('/:id', adminMiddleware, mediaController.updateMedia);
router.delete('/:id', adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', adminMiddleware, mediaController.updateThumbnail);

module.exports = router;
