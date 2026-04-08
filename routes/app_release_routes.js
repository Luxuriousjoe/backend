const express = require('express');
const router = express.Router();

const appReleaseController = require('../controllers/app_release_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

router.get('/latest', authMiddleware, appReleaseController.getLatest);
router.get('/latest/download', appReleaseController.downloadLatest);
router.get('/admin', adminMiddleware, appReleaseController.getAdminList);
router.post('/', adminMiddleware, upload.single('file'), appReleaseController.create);

module.exports = router;
