const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/media_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

router.post('/', adminMiddleware, upload.single('file'), mediaController.createMedia);
// Public routes (authenticated users)
router.get('/', authMiddleware, mediaController.getAllMedia);
router.get('/:id', authMiddleware, mediaController.getMediaById);

// Admin-only routes
router.post('/', adminMiddleware, mediaController.createMedia);
router.put('/:id', adminMiddleware, mediaController.updateMedia);
router.delete('/:id', adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', adminMiddleware, mediaController.updateThumbnail);
router.get('/admin/queue', adminMiddleware, mediaController.getAdminQueue);

module.exports = router;
