// ============================================================
// ImageKit Image Upload Server
// ------------------------------------------------------------
// Architecture (client-side direct upload):
//   Browser  --GET /auth-->  Server  (returns signature/token/expire)
//   Browser  --POST /api/v1/files/upload-->  ImageKit (direct)
//
// Optional: POST /upload acts as a server-side proxy upload
// for cases where you'd rather not expose auth params at all.
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');
const ImageKit = require('imagekit');

// ------------------------------------------------------------
// App initialization
// ------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// Env vars (trim to avoid trailing newline issues on some hosts)
const IMAGEKIT_PUBLIC_KEY = (process.env.IMAGEKIT_PUBLIC_KEY || '').trim();
const IMAGEKIT_PRIVATE_KEY = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
const IMAGEKIT_URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || '').trim();

if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) {
  console.warn('[WARN] ImageKit env vars are not fully configured. Check your .env file.');
}

// ------------------------------------------------------------
// ImageKit SDK instance
// ------------------------------------------------------------
const imagekit = new ImageKit({
  publicKey: IMAGEKIT_PUBLIC_KEY,
  privateKey: IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: IMAGEKIT_URL_ENDPOINT,
});

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve static files (index.html, client.js) from project root
app.use(express.static(path.join(__dirname)));

// Multer: keep file in memory for the optional proxy /upload route
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

/**
 * GET /auth
 * Returns authentication parameters the browser needs to
 * upload directly to ImageKit.
 *
 * Response:
 *   {
 *     success: true,
 *     data: { signature, token, expire, publicKey, urlEndpoint }
 *   }
 */
app.get('/auth', (_req, res) => {
  try {
    const authParams = imagekit.getAuthenticationParameters();
    res.json({
      success: true,
      data: {
        ...authParams,
        publicKey: IMAGEKIT_PUBLIC_KEY,
        urlEndpoint: IMAGEKIT_URL_ENDPOINT,
      },
    });
  } catch (err) {
    console.error('[/auth] Error generating auth params:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate ImageKit authentication parameters',
    });
  }
});

/**
 * POST /upload
 * Optional server-side proxy upload.
 * Client sends multipart/form-data with field name "file".
 *
 * Response:
 *   { success: true, data: { url, fileId, name, size, ... } }
 */
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Expected multipart field "file".',
      });
    }

    const result = await imagekit.upload({
      file: req.file.buffer, // Buffer is accepted by the SDK
      fileName: req.file.originalname || `upload_${Date.now()}`,
      folder: '/uploads',
      useUniqueFileName: true,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[/upload] Error uploading to ImageKit:', err);
    res.status(500).json({
      success: false,
      message: err?.message || 'Upload failed',
    });
  }
});

// Root -> serve index.html (also covered by express.static, but explicit is nice)
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// Error handler (Multer + generic)
// ------------------------------------------------------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    console.error('[Unhandled error]', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// ------------------------------------------------------------
// Start server (local) / export app (serverless)
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ImageKit upload server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
