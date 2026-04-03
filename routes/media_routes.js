const express = require('express');
const router = express.Router();

const mediaController = require('../controllers/media_controller');
const authMiddleware = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

// If auth_middleware exports adminOnly, use this:
const adminMiddleware = authMiddleware.adminOnly || authMiddleware.isAdmin;

// Public/authenticated routes
router.get('/', authMiddleware.verifyToken || authMiddleware, mediaController.getAllMedia);
router.get('/queue/admin', authMiddleware.verifyToken || authMiddleware, adminMiddleware, mediaController.getAdminQueue);
router.get('/:id', authMiddleware.verifyToken || authMiddleware, mediaController.getMediaById);

// Admin routes
router.post(
  '/',
  authMiddleware.verifyToken || authMiddleware,
  adminMiddleware,
  upload.single('file'),
  mediaController.createMedia
);

router.put('/:id', authMiddleware.verifyToken || authMiddleware, adminMiddleware, mediaController.updateMedia);
router.delete('/:id', authMiddleware.verifyToken || authMiddleware, adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', authMiddleware.verifyToken || authMiddleware, adminMiddleware, mediaController.updateThumbnail);

module.exports = router;
