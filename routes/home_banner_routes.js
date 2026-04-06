const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload_middleware');
const homeBannerController = require('../controllers/home_banner_controller');
const { authMiddleware, homeBannerAdminMiddleware } = require('../middleware/auth_middleware');

router.get('/', authMiddleware, homeBannerController.getAll);
router.get('/admin', homeBannerAdminMiddleware, homeBannerController.getAdminList);
router.get('/:id/file', homeBannerController.streamFile);
router.post('/', homeBannerAdminMiddleware, upload.single('file'), homeBannerController.upload);
router.patch('/:id/toggle', homeBannerAdminMiddleware, homeBannerController.toggle);
router.delete('/:id', homeBannerAdminMiddleware, homeBannerController.remove);

module.exports = router;
