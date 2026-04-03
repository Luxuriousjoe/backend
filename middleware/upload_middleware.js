const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(process.cwd(), 'uploads_tmp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
  },
});

module.exports = upload;
