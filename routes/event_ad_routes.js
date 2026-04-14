const express = require('express');
const router = express.Router();

const upload = require('../middleware/upload_middleware');
const authGuards = require('../middleware/auth_middleware');
const eventAdController = require('../controllers/event_ad_controller');

const authMiddleware = authGuards.authMiddleware;
const eventAdAdminMiddleware =
  authGuards.homeBannerAdminMiddleware || authGuards.adminMiddleware;

router.get('/', authMiddleware, eventAdController.getAll);
router.get('/admin', eventAdAdminMiddleware, eventAdController.getAdminList);
router.get('/:id/file', eventAdController.streamFile);
router.post('/', eventAdAdminMiddleware, upload.single('file'), eventAdController.create);
router.patch('/:id/toggle', eventAdAdminMiddleware, eventAdController.toggle);
router.delete('/:id', eventAdAdminMiddleware, eventAdController.remove);

module.exports = router;
