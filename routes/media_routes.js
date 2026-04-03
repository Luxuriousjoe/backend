const express = require('express');
const router = express.Router();

const mediaController = require('../controllers/media_controller');
const authMiddleware = require('../middleware/auth_middleware');
const adminMiddleware = require('../middleware/admin_middleware');
const upload = require('../middleware/upload_middleware');

// Public / authenticated media listing
router.get('/', authMiddleware, mediaController.getAllMedia);
router.get('/queue/admin', authMiddleware, adminMiddleware, mediaController.getAdminQueue);
router.get('/:id', authMiddleware, mediaController.getMediaById);

// Admin actions
router.post('/', authMiddleware, adminMiddleware, upload.single('file'), mediaController.createMedia);
router.put('/:id', authMiddleware, adminMiddleware, mediaController.updateMedia);
router.delete('/:id', authMiddleware, adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', authMiddleware, adminMiddleware, mediaController.updateThumbnail);

module.exports = router;
