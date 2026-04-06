const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload_middleware');
const { authMiddleware, homeBannerAdminMiddleware } = require('../middleware/auth_middleware');
let homeBannerController;

try {
  homeBannerController = require('../controllers/home_banner_controller');
} catch (error) {
  const unavailable = (req, res) =>
    res.status(503).json({
      success: false,
      message: 'Home banner feature is temporarily unavailable on this deployment.',
      detail: error.message,
    });
  homeBannerController = {
    getAll: unavailable,
    getAdminList: unavailable,
    streamFile: unavailable,
    upload: unavailable,
    toggle: unavailable,
    remove: unavailable,
  };
}

router.get('/', authMiddleware, homeBannerController.getAll);
router.get('/admin', homeBannerAdminMiddleware, homeBannerController.getAdminList);
router.get('/:id/file', homeBannerController.streamFile);
router.post('/', homeBannerAdminMiddleware, upload.single('file'), homeBannerController.upload);
router.patch('/:id/toggle', homeBannerAdminMiddleware, homeBannerController.toggle);
router.delete('/:id', homeBannerAdminMiddleware, homeBannerController.remove);

module.exports = router;
