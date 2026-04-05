const express = require('express');
const router = express.Router();

const mediaController = require('../controllers/media_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

router.get('/', authMiddleware, mediaController.getAllMedia);
router.get('/queue/admin', adminMiddleware, mediaController.getAdminQueue);
router.get('/:id/file', authMiddleware, mediaController.streamMediaFile);
router.get('/:id', authMiddleware, mediaController.getMediaById);
router.post('/:id/visit', authMiddleware, mediaController.recordVisit);

router.post('/', adminMiddleware, upload.single('file'), mediaController.createMedia);
router.put('/:id', adminMiddleware, mediaController.updateMedia);
router.delete('/:id', adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', adminMiddleware, mediaController.updateThumbnail);

module.exports = router;
